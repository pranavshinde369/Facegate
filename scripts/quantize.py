from onnxruntime.quantization import quantize_dynamic, QuantType
import os

print('Quantizing...')
quantize_dynamic(
    'android/app/src/main/assets/models/mobilefacenet_fp32.onnx',
    'android/app/src/main/assets/models/mobilefacenet_int8.onnx',
    weight_type=QuantType.QUInt8
)

fp32 = os.path.getsize('android/app/src/main/assets/models/mobilefacenet_fp32.onnx')/1024/1024
int8 = os.path.getsize('android/app/src/main/assets/models/mobilefacenet_int8.onnx')/1024/1024
total = os.path.getsize('android/app/src/main/assets/models/ultraface.onnx')/1024/1024 + int8

print(f'FP32: {fp32:.2f} MB -> INT8: {int8:.2f} MB')
print(f'Total bundle: {total:.2f} MB')
print('PASS!' if total < 20 else 'Too large but still usable')