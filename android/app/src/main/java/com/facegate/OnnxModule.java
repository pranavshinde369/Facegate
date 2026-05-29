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
     * HIGH-PERFORMANCE: Detect face directly from image URI.
     * Does decode + resize + normalize + CHW reformat + ONNX inference ALL on Java side.
     * Avoids the massive overhead of passing 1.2M pixel values over the RN bridge.
     *
     * Returns the flattened output array (scores + boxes for UltraFace).
     */
    @ReactMethod
    public void detectFaceFromUri(String modelName, String uri, Promise promise) {
        try {
            OrtSession session = sessions.get(modelName);
            if (session == null) {
                promise.reject("NOT_LOADED", "Model not loaded: " + modelName);
                return;
            }

            String filePath = uri.replace("file://", "");
            Bitmap original = BitmapFactory.decodeFile(filePath);
            if (original == null) {
                promise.reject("DECODE_ERR", "Failed to decode image");
                return;
            }

            // Resize to detector input: 320x240
            int targetW = 320, targetH = 240;
            Bitmap scaled = Bitmap.createScaledBitmap(original, targetW, targetH, true);

            // Convert to CHW float array with /255.0 normalization
            float[] inputData = new float[3 * targetH * targetW];
            for (int y = 0; y < targetH; y++) {
                for (int x = 0; x < targetW; x++) {
                    int pixel = scaled.getPixel(x, y);
                    float r = ((pixel >> 16) & 0xFF) / 255.0f;
                    float g = ((pixel >> 8) & 0xFF) / 255.0f;
                    float b = (pixel & 0xFF) / 255.0f;

                    inputData[0 * targetH * targetW + y * targetW + x] = r;
                    inputData[1 * targetH * targetW + y * targetW + x] = g;
                    inputData[2 * targetH * targetW + y * targetW + x] = b;
                }
            }

            // Run inference
            long[] dims = {1, 3, targetH, targetW};
            OnnxTensor tensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(inputData), dims);
            Map<String, OnnxTensor> inputs = new HashMap<>();
            String inputName = session.getInputNames().iterator().next();
            inputs.put(inputName, tensor);

            long startTime = System.currentTimeMillis();
            OrtSession.Result result = session.run(inputs);
            long inferenceMs = System.currentTimeMillis() - startTime;
            inferenceTimings.put(modelName, inferenceMs);

            // Flatten all outputs
            WritableArray out = Arguments.createArray();
            for (int i = 0; i < result.size(); i++) {
                flattenOutput(result.get(i).getValue(), out);
            }

            // Also return image dimensions for bbox scaling
            out.pushDouble(original.getWidth());  // original width
            out.pushDouble(original.getHeight()); // original height

            tensor.close();
            result.close();
            if (original != scaled) original.recycle();
            scaled.recycle();

            promise.resolve(out);
        } catch (Exception e) {
            promise.reject("DETECT_ERR", e.getMessage());
        }
    }

    /**
     * HIGH-PERFORMANCE: Extract face embedding directly from image URI + bounding box.
     * Crops the face region, resizes to 112x112, normalizes with (p/255 - 0.5)/0.5,
     * converts to CHW, and runs MobileFaceNet — ALL on Java side.
     *
     * Returns the 128-d embedding array.
     */
    @ReactMethod
    public void extractEmbeddingFromUri(String modelName, String uri,
                                         double x1, double y1, double x2, double y2,
                                         Promise promise) {
        try {
            OrtSession session = sessions.get(modelName);
            if (session == null) {
                promise.reject("NOT_LOADED", "Model not loaded: " + modelName);
                return;
            }

            String filePath = uri.replace("file://", "");
            Bitmap original = BitmapFactory.decodeFile(filePath);
            if (original == null) {
                promise.reject("DECODE_ERR", "Failed to decode image");
                return;
            }

            int imgW = original.getWidth();
            int imgH = original.getHeight();

            // Convert normalized bbox [0-1] to pixel coordinates
            int cropX = Math.max(0, (int)(x1 * imgW));
            int cropY = Math.max(0, (int)(y1 * imgH));
            int cropW = Math.max(1, Math.min((int)((x2 - x1) * imgW), imgW - cropX));
            int cropH = Math.max(1, Math.min((int)((y2 - y1) * imgH), imgH - cropY));

            // Crop and resize to 112x112
            Bitmap cropped = Bitmap.createBitmap(original, cropX, cropY, cropW, cropH);
            int targetSize = 112;
            Bitmap face = Bitmap.createScaledBitmap(cropped, targetSize, targetSize, true);

            // Convert to CHW float array with MobileFaceNet normalization: (p/255 - 0.5) / 0.5
            float[] inputData = new float[3 * targetSize * targetSize];
            for (int y = 0; y < targetSize; y++) {
                for (int x = 0; x < targetSize; x++) {
                    int pixel = face.getPixel(x, y);
                    float r = (((pixel >> 16) & 0xFF) / 255.0f - 0.5f) / 0.5f;
                    float g = (((pixel >> 8) & 0xFF) / 255.0f - 0.5f) / 0.5f;
                    float b = ((pixel & 0xFF) / 255.0f - 0.5f) / 0.5f;

                    inputData[0 * targetSize * targetSize + y * targetSize + x] = r;
                    inputData[1 * targetSize * targetSize + y * targetSize + x] = g;
                    inputData[2 * targetSize * targetSize + y * targetSize + x] = b;
                }
            }

            // Run inference
            long[] dims = {1, 3, targetSize, targetSize};
            OnnxTensor tensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(inputData), dims);
            Map<String, OnnxTensor> inputs = new HashMap<>();
            String inputName = session.getInputNames().iterator().next();
            inputs.put(inputName, tensor);

            long startTime = System.currentTimeMillis();
            OrtSession.Result result = session.run(inputs);
            long inferenceMs = System.currentTimeMillis() - startTime;
            inferenceTimings.put(modelName, inferenceMs);

            // Flatten output (should be [1,128] → 128 floats)
            WritableArray out = Arguments.createArray();
            for (int i = 0; i < result.size(); i++) {
                flattenOutput(result.get(i).getValue(), out);
            }

            tensor.close();
            result.close();
            original.recycle();
            if (cropped != face) cropped.recycle();
            face.recycle();

            promise.resolve(out);
        } catch (Exception e) {
            promise.reject("EMBED_ERR", e.getMessage());
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
     * Proper image decoding using Android's BitmapFactory.
     * Kept as fallback but prefer detectFaceFromUri / extractEmbeddingFromUri
     * for performance (avoids massive bridge data transfer).
     */
    @ReactMethod
    public void decodeImageToPixels(String uri, int targetW, int targetH, Promise promise) {
        try {
            String filePath = uri.replace("file://", "");
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
            Bitmap original = BitmapFactory.decodeFile(filePath, opts);

            if (original == null) {
                promise.reject("DECODE_ERR", "Failed to decode image: " + filePath);
                return;
            }

            Bitmap scaled = Bitmap.createScaledBitmap(original, targetW, targetH, true);

            WritableArray arr = Arguments.createArray();
            for (int y = 0; y < targetH; y++) {
                for (int x = 0; x < targetW; x++) {
                    int pixel = scaled.getPixel(x, y);
                    arr.pushInt((pixel >> 16) & 0xFF);
                    arr.pushInt((pixel >> 8) & 0xFF);
                    arr.pushInt(pixel & 0xFF);
                    arr.pushInt(255);
                }
            }

            if (original != scaled) original.recycle();
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