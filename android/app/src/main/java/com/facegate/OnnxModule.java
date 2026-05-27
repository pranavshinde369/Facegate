package com.facegate;

import ai.onnxruntime.*;
import android.content.res.AssetManager;
import com.facebook.react.bridge.*;
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
            byte[] modelBytes = is.readAllBytes();
            is.close();

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

            // Get output as float array
            Object outputValue = result.get(0).getValue();
            WritableArray out = Arguments.createArray();

            if (outputValue instanceof float[][]) {
                float[][] output = (float[][]) outputValue;
                for (float v : output[0]) out.pushDouble(v);
            } else if (outputValue instanceof float[][][]) {
                float[][][] output = (float[][][]) outputValue;
                for (float[] row : output[0]) {
                    for (float v : row) out.pushDouble(v);
                }
            }

            tensor.close();
            result.close();
            promise.resolve(out);
        } catch (Exception e) {
            promise.reject("INFERENCE_ERROR", e.getMessage());
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