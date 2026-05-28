import os
import onnx
from onnxruntime.quantization import quantize_dynamic, QuantType
from huggingface_hub import hf_hub_download

os.makedirs("android/app/src/main/assets/models", exist_ok=True)

# UltraFace already downloaded — skip if exists
if os.path.exists("android/app/src/main/assets/models/ultraface.onnx"):
    size = os.path.getsize("android/app/src/main/assets/models/ultraface.onnx") / 1024 / 1024
    print(f"UltraFace already exists: {size:.2f} MB - skipping")
else:
    import urllib.request
    print("Downloading UltraFace detector...")
    urllib.request.urlretrieve(
        "https://github.com/onnx/models/raw/main/validated/vision/body_analysis/ultraface/models/version-RFB-320.onnx",
        "android/app/src/main/assets/models/ultraface.onnx"
    )
    print(f"UltraFace: {os.path.getsize('android/app/src/main/assets/models/ultraface.onnx')/1024/1024:.2f} MB")

# Download MobileFaceNet from HuggingFace
print("Downloading MobileFaceNet from HuggingFace...")
path = hf_hub_download(
    repo_id="facenet-pytorch/facenet-pytorch",
    filename="20180402-114759-vggface2.pt",
)
print(f"Downloaded to: {path}")