package com.facegate;

import ai.onnxruntime.*;
import android.content.res.AssetManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import com.facebook.react.bridge.*;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.FloatBuffer;
import java.util.*;

public class OnnxModule extends ReactContextBaseJavaModule {

    private OrtEnvironment env;
    private Map<String, OrtSession> sessions = new HashMap<>();
    private Map<String, Long> inferenceTimings = new HashMap<>();

    public OnnxModule(ReactApplicationContext ctx) {
        super(ctx);
        try {
            env = OrtEnvironment.getEnvironment();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public String getName() {
        return "OnnxModule";
    }

    @ReactMethod
    public void loadModel(String modelName, Promise promise) {
        try {
            AssetManager am = getReactApplicationContext().getAssets();
            InputStream is = am.open("models/" + modelName);

            // Bug #5 fix: readAllBytes() requires API 33+, use buffer approach instead
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int bytesRead;
            while ((bytesRead = is.read(buffer)) != -1) {
                bos.write(buffer, 0, bytesRead);
            }
            byte[] modelBytes = bos.toByteArray();
            is.close();
            bos.close();

            OrtSession.SessionOptions opts = new OrtSession.SessionOptions();
            opts.setIntraOpNumThreads(2);
            opts.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);

            OrtSession session = env.createSession(modelBytes, opts);
            sessions.put(modelName, session);
            promise.resolve("loaded:" + modelName);
        } catch (Exception e) {
            promise.reject("LOAD_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void runInference(String modelName, ReadableArray inputData,
                              ReadableArray shape, Promise promise) {
        try {
            OrtSession session = sessions.get(modelName);
            if (session == null) {
                promise.reject("NOT_LOADED", "Model not loaded: " + modelName);
                return;
            }

            float[] data = new float[inputData.size()];
            for (int i = 0; i < inputData.size(); i++) {
                data[i] = (float) inputData.getDouble(i);
            }

            long[] dims = new long[shape.size()];
            for (int i = 0; i < shape.size(); i++) {
                dims[i] = shape.getInt(i);
            }

            OnnxTensor tensor = OnnxTensor.createTensor(env,
                FloatBuffer.wrap(data), dims);

            Map<String, OnnxTensor> inputs = new HashMap<>();
            String inputName = session.getInputNames().iterator().next();
            inputs.put(inputName, tensor);

            long startTime = System.currentTimeMillis();
            OrtSession.Result result = session.run(inputs);
            long inferenceMs = System.currentTimeMillis() - startTime;
            inferenceTimings.put(modelName, inferenceMs);

            // Bug #4 fix: Concatenate ALL output tensors, not just the first one.
            // UltraFace has two outputs: scores [1,4420,2] and boxes [1,4420,4].
            // MobileFaceNet has one output: embedding [1,128].
            // We flatten all outputs into a single array for the JS side.
            WritableArray out = Arguments.createArray();
            for (int i = 0; i < result.size(); i++) {
                Object outputValue = result.get(i).getValue();
                flattenOutput(outputValue, out);
            }

            tensor.close();
            result.close();
            promise.resolve(out);
        } catch (Exception e) {
            promise.reject("INFERENCE_ERROR", e.getMessage());
        }
    }

    /**
     * Recursively flattens ONNX output tensors into a WritableArray.
     * Handles float[], float[][], and float[][][] shapes.
     */
    private void flattenOutput(Object value, WritableArray out) {
        if (value instanceof float[]) {
            for (float v : (float[]) value) {
                out.pushDouble(v);
            }
        } else if (value instanceof float[][]) {
            float[][] arr = (float[][]) value;
            for (float[] row : arr) {
                for (float v : row) {
                    out.pushDouble(v);
                }
            }
        } else if (value instanceof float[][][]) {
            float[][][] arr = (float[][][]) value;
            for (float[][] mat : arr) {
                for (float[] row : mat) {
                    for (float v : row) {
                        out.pushDouble(v);
                    }
                }
            }
        }
    }

    /**
     * Bug #1 fix: Proper image decoding using Android's BitmapFactory.
     * Decodes a JPEG/PNG file into an RGBA pixel array at the specified dimensions.
     * Returns a flat array of [R, G, B, A, R, G, B, A, ...] values (0-255).
     */
    @ReactMethod
    public void decodeImageToPixels(String uri, int targetW, int targetH, Promise promise) {
        try {
            String filePath = uri.replace("file://", "");

            // Decode with downsampling for memory efficiency
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
            Bitmap original = BitmapFactory.decodeFile(filePath, opts);

            if (original == null) {
                promise.reject("DECODE_ERR", "Failed to decode image: " + filePath);
                return;
            }

            // Scale to target dimensions
            Bitmap scaled = Bitmap.createScaledBitmap(original, targetW, targetH, true);

            // Extract RGBA pixels
            WritableArray arr = Arguments.createArray();
            for (int y = 0; y < targetH; y++) {
                for (int x = 0; x < targetW; x++) {
                    int pixel = scaled.getPixel(x, y);
                    arr.pushInt((pixel >> 16) & 0xFF); // R
                    arr.pushInt((pixel >> 8) & 0xFF);  // G
                    arr.pushInt(pixel & 0xFF);          // B
                    arr.pushInt(255);                    // A
                }
            }

            // Recycle bitmaps to free native memory
            if (original != scaled) {
                original.recycle();
            }
            scaled.recycle();

            promise.resolve(arr);
        } catch (Exception e) {
            promise.reject("DECODE_ERR", e.getMessage());
        }
    }

    @ReactMethod
    public void getInferenceTime(String modelName, Promise promise) {
        Long time = inferenceTimings.get(modelName);
        promise.resolve(time != null ? time.intValue() : 0);
    }

    @ReactMethod
    public void isModelLoaded(String modelName, Promise promise) {
        promise.resolve(sessions.containsKey(modelName));
    }

    @ReactMethod
    public void getModelBundleSizeMB(Promise promise) {
        try {
            AssetManager am = getReactApplicationContext().getAssets();
            String[] models = am.list("models");
            long totalBytes = 0;
            for (String model : models) {
                InputStream is = am.open("models/" + model);
                totalBytes += is.available();
                is.close();
            }
            promise.resolve((double) totalBytes / 1024 / 1024);
        } catch (Exception e) {
            promise.resolve(0.0);
        }
    }
}