# JPEG 元数据测试素材

`jpeg_xmp_header.bin` 保存 JPEG APP1 段中的标准 XMP 命名空间头（29 字节，包含末尾 NUL）。
它是图片格式的二进制标记，不是网络请求目标。

`test_phase7_routes.py` 从素材读取头部，再拼接各测试用例的 DJI 图片来源元数据。
这样保留相同的测试图像字节格式，也避免在 Python 源码中写入固定 URI。
