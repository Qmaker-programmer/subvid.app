// Dedicated Web Worker that hosts the Whisper ASR transformers.js pipeline.
// Loading and running inference is heavy CPU/WASM work that would otherwise
// freeze the main thread (the UI, progress bars, etc.).
//
// Protocol (main ⇄ worker):
//   → { id, type: "ensure-asr", payload: { model, webgpu } }
//   → { id, type: "transcribe", payload: { audio, language, wordTimestamps } }
//                                                             // audio buffer transferred
//   ← { type: "progress", key, payload }   // streamed model-download progress
//   ← { type: "chunk" }                     // streamed per-chunk ASR progress
//   ← { id, type: "done", result? }         // request finished
//   ← { id, type: "error", error }          // request failed

import { env, pipeline } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;

let recognizer: any = null;
let recognizerDevice: "webgpu" | "wasm" = "wasm";
let recognizerModel: string = "";

const post = (msg: any, transfer: Transferable[] = []) =>
  (self as any).postMessage(msg, transfer);

self.onmessage = async (event: MessageEvent) => {
  const { id, type, payload } = event.data || {};
  try {
    if (type === "ensure-asr") {
      if (!recognizer) {
        const baseOptions: any = {
          progress_callback: (p: any) =>
            post({ type: "progress", key: "asr", payload: p }),
        };

        // Try WebGPU first if requested
        if (payload?.webgpu) {
          try {
            console.info("[ASR] attempting to load Whisper on WebGPU");
            recognizer = await pipeline(
              "automatic-speech-recognition",
              payload.model,
              {
                ...baseOptions,
                device: "webgpu",
                dtype: {
                  encoder_model: "fp32",
                  decoder_model_merged: "fp32",
                },
              },
            );
            recognizerDevice = "webgpu";
            recognizerModel = payload.model;
            console.info("[ASR] Whisper loaded successfully on WebGPU");
          } catch (error: any) {
            const errorMsg = error?.message || String(error);
            console.warn(
              "[ASR] WebGPU failed, falling back to WASM/CPU:",
              errorMsg,
            );
            recognizer = null;
          }
        }

        // Fallback to WASM/CPU if WebGPU failed or wasn't requested
        if (!recognizer) {
          console.info("[ASR] loading Whisper on WASM/CPU backend");
          recognizer = await pipeline(
            "automatic-speech-recognition",
            payload.model,
            {
              ...baseOptions,
              dtype: {
                encoder_model: "fp32",
                decoder_model_merged: "fp32",
              },
            },
          );
          recognizerDevice = "wasm";
          recognizerModel = payload.model;
          console.info("[ASR] Whisper loaded successfully on WASM/CPU");
        }
      }
      post({ id, type: "done" });
    } else if (type === "transcribe") {
      let output;
      try {
        output = await recognizer(payload.audio, {
          chunk_length_s: 30,
          stride_length_s: 5,
          return_timestamps: payload.wordTimestamps ? "word" : true,
          language: payload.language || null,
          chunk_callback: () => post({ type: "chunk" }),
        });
      } catch (error: any) {
        // If transcription fails on WebGPU, try reloading on WASM/CPU
        if (recognizerDevice === "webgpu") {
          const errorMsg = error?.message || String(error);
          console.warn(
            "[ASR] Transcription failed on WebGPU, retrying on WASM/CPU:",
            errorMsg,
          );
          const model = recognizerModel || "Xenova/whisper-base";
          recognizer = null;
          const baseOptions: any = {
            progress_callback: (p: any) =>
              post({ type: "progress", key: "asr", payload: p }),
          };
          recognizer = await pipeline("automatic-speech-recognition", model, {
            ...baseOptions,
            dtype: {
              encoder_model: "fp32",
              decoder_model_merged: "fp32",
            },
          });
          recognizerDevice = "wasm";
          console.info("[ASR] Retrying transcription on WASM/CPU");
          output = await recognizer(payload.audio, {
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: payload.wordTimestamps ? "word" : true,
            language: payload.language || null,
            chunk_callback: () => post({ type: "chunk" }),
          });
        } else {
          throw error;
        }
      }
      post({ id, type: "done", result: output });
    } else {
      post({ id, type: "error", error: `Unknown message type: ${type}` });
    }
  } catch (err: any) {
    post({ id, type: "error", error: String(err?.message || err) });
  }
};
