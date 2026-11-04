# -*- coding: utf-8 -*-
"""Export a Metashape 2.0.2+ model as a self-georeferenced Web GLB package.

Select exactly one positioned Marker to use it as the local ENU origin. If no
Marker is selected, the active Chunk region center is used. Run this file from
Metashape via Tools > Run Script, then upload only the generated GLB to the Web
application; JSON/XML/CSV sidecars are retained for inspection and diagnostics.
"""

import Metashape
import json
import math
import os
import re
import shutil
import struct

WGS84 = Metashape.CoordinateSystem("EPSG::4326")
WGS84_GEOCENTRIC = WGS84.geoccs
SCRIPT_VERSION = "2026-08-28.3-metashape-2.0.2"

def vec3(v):
    return [float(v[0]), float(v[1]), float(v[2])]

def mat_to_list(m):
    return [[float(m[r, c]) for c in range(m.size[1])] for r in range(m.size[0])]

def enu_to_gltf_yup(v):
    return [float(v[0]), float(v[2]), -float(v[1])]

def build_topocentric_wkt(lon_deg, lat_deg, h_m):
    return f'''PROJCRS["Metashape Web Local ENU",
    BASEGEOGCRS["WGS 84",
        DATUM["World Geodetic System 1984",
            ELLIPSOID["WGS 84",6378137,298.257223563,
                LENGTHUNIT["metre",1]]],
        PRIMEM["Greenwich",0,
            ANGLEUNIT["degree",0.0174532925199433]],
        ID["EPSG",4979]],
    CONVERSION["Local topocentric",
        METHOD["Geographic/topocentric conversions",
            ID["EPSG",9837]],
        PARAMETER["Latitude of topocentric origin",{lat_deg:.12f},
            ANGLEUNIT["degree",0.0174532925199433],
            ID["EPSG",8834]],
        PARAMETER["Longitude of topocentric origin",{lon_deg:.12f},
            ANGLEUNIT["degree",0.0174532925199433],
            ID["EPSG",8835]],
        PARAMETER["Ellipsoidal height of topocentric origin",{h_m:.6f},
            LENGTHUNIT["metre",1],
            ID["EPSG",8836]]],
    CS[Cartesian,3],
        AXIS["topocentric East (E)",east,ORDER[1],LENGTHUNIT["metre",1]],
        AXIS["topocentric North (N)",north,ORDER[2],LENGTHUNIT["metre",1]],
        AXIS["topocentric Up (U)",up,ORDER[3],LENGTHUNIT["metre",1]]]
]'''

def safe_photo_filename(camera):
    try:
        return os.path.basename(camera.photo.path) if camera.photo and camera.photo.path else None
    except Exception:
        return None

def point_to_wgs84_ecef(point, source_geocentric):
    return Metashape.CoordinateSystem.transform(
        point,
        source_geocentric,
        WGS84_GEOCENTRIC
    )

def chunk_point_to_glb_yup(point, chunk_transform, source_geocentric, export_crs):
    source_ecef = chunk_transform.mulp(point)
    wgs84_ecef = point_to_wgs84_ecef(source_ecef, source_geocentric)
    return enu_to_gltf_yup(export_crs.project(wgs84_ecef))

def camera_to_glb_yup_matrix(camera, chunk_transform, source_geocentric, export_crs):
    camera_origin = chunk_point_to_glb_yup(
        camera.transform.mulp(Metashape.Vector([0.0, 0.0, 0.0])),
        chunk_transform,
        source_geocentric,
        export_crs
    )
    camera_x = chunk_point_to_glb_yup(
        camera.transform.mulp(Metashape.Vector([1.0, 0.0, 0.0])),
        chunk_transform,
        source_geocentric,
        export_crs
    )
    camera_y = chunk_point_to_glb_yup(
        camera.transform.mulp(Metashape.Vector([0.0, 1.0, 0.0])),
        chunk_transform,
        source_geocentric,
        export_crs
    )
    camera_z = chunk_point_to_glb_yup(
        camera.transform.mulp(Metashape.Vector([0.0, 0.0, 1.0])),
        chunk_transform,
        source_geocentric,
        export_crs
    )

    x_axis = [camera_x[i] - camera_origin[i] for i in range(3)]
    y_axis = [camera_y[i] - camera_origin[i] for i in range(3)]
    z_axis = [camera_z[i] - camera_origin[i] for i in range(3)]
    return [
        [x_axis[0], y_axis[0], z_axis[0], camera_origin[0]],
        [x_axis[1], y_axis[1], z_axis[1], camera_origin[1]],
        [x_axis[2], y_axis[2], z_axis[2], camera_origin[2]],
        [0.0, 0.0, 0.0, 1.0]
    ]

def add_z_up_to_y_up_scene_roots(gltf):
    scenes = gltf.get("scenes")
    nodes = gltf.get("nodes")
    if not isinstance(scenes, list) or not isinstance(nodes, list):
        raise RuntimeError("旧版 Metashape 导出的 GLB 缺少 scenes 或 nodes，无法转换为 Y-up。")

    # glTF matrices are serialized column-major. This represents:
    # X' = X, Y' = Z, Z' = -Y (ENU Z-up -> glTF Y-up).
    z_up_to_y_up = [
        1.0, 0.0, 0.0, 0.0,
        0.0, 0.0, -1.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 0.0, 1.0
    ]
    for scene_index, scene in enumerate(scenes):
        if not isinstance(scene, dict):
            raise RuntimeError("GLB scene 数据无效，无法转换为 Y-up。")
        root_nodes = scene.get("nodes", [])
        if not root_nodes:
            continue
        wrapper_index = len(nodes)
        nodes.append({
            "name": "Metashape Web Z-up to Y-up",
            "matrix": z_up_to_y_up,
            "children": list(root_nodes),
            "extras": {"metashape_web_axis_wrapper": True, "scene_index": scene_index}
        })
        scene["nodes"] = [wrapper_index]

def inspect_glb_appearance(glb_path):
    with open(glb_path, "rb") as source:
        header = source.read(12)
        if len(header) != 12:
            raise RuntimeError("GLB 文件头不完整，无法检查纹理。")
        magic, version, total_length = struct.unpack("<4sII", header)
        if magic != b"glTF" or version != 2 or total_length != os.path.getsize(glb_path):
            raise RuntimeError("导出结果不是完整的 glTF 2.0 GLB，无法检查纹理。")

        chunk_header = source.read(8)
        if len(chunk_header) != 8:
            raise RuntimeError("GLB 缺少 JSON Chunk，无法检查纹理。")
        json_length, chunk_type = struct.unpack("<I4s", chunk_header)
        if chunk_type != b"JSON":
            raise RuntimeError("GLB 的首个 Chunk 不是 JSON，无法检查纹理。")
        gltf = json.loads(source.read(json_length).rstrip(b" \t\r\n\x00").decode("utf-8"))

    textured_materials = 0
    vertex_color_primitives = 0
    uv_primitives = 0
    for material in gltf.get("materials", []):
        pbr = material.get("pbrMetallicRoughness", {}) if isinstance(material, dict) else {}
        if isinstance(pbr, dict) and isinstance(pbr.get("baseColorTexture"), dict):
            textured_materials += 1
    for mesh in gltf.get("meshes", []):
        for primitive in mesh.get("primitives", []) if isinstance(mesh, dict) else []:
            attributes = primitive.get("attributes", {}) if isinstance(primitive, dict) else {}
            if "COLOR_0" in attributes:
                vertex_color_primitives += 1
            if "TEXCOORD_0" in attributes:
                uv_primitives += 1

    return {
        "material_count": len(gltf.get("materials", [])),
        "texture_count": len(gltf.get("textures", [])),
        "image_count": len(gltf.get("images", [])),
        "textured_material_count": textured_materials,
        "uv_primitive_count": uv_primitives,
        "vertex_color_primitive_count": vertex_color_primitives
    }

def inject_glb_web_package(glb_path, package, convert_z_up_to_y_up=False):
    temporary_path = glb_path + ".metadata.tmp"
    try:
        with open(glb_path, "rb") as source, open(temporary_path, "wb") as target:
            header = source.read(12)
            if len(header) != 12:
                raise RuntimeError("GLB 文件头不完整。")
            magic, version, total_length = struct.unpack("<4sII", header)
            if magic != b"glTF" or version != 2:
                raise RuntimeError("导出结果不是有效的 glTF 2.0 GLB。")
            if total_length != os.path.getsize(glb_path):
                raise RuntimeError("GLB 文件长度校验失败。")

            chunk_header = source.read(8)
            if len(chunk_header) != 8:
                raise RuntimeError("GLB 缺少首个 JSON Chunk。")
            original_json_length, chunk_type = struct.unpack("<I4s", chunk_header)
            if chunk_type != b"JSON":
                raise RuntimeError("GLB 的首个 Chunk 不是 JSON。")
            original_json = source.read(original_json_length)
            if len(original_json) != original_json_length:
                raise RuntimeError("GLB JSON Chunk 内容不完整。")

            gltf = json.loads(original_json.rstrip(b" \t\r\n\x00").decode("utf-8"))
            asset = gltf.setdefault("asset", {})
            extras = asset.get("extras")
            if extras is None:
                extras = {}
                asset["extras"] = extras
            if not isinstance(extras, dict):
                raise RuntimeError("GLB asset.extras 不是对象，无法安全写入配准信息。")
            extras["metashape_web_package"] = package
            if convert_z_up_to_y_up:
                add_z_up_to_y_up_scene_roots(gltf)

            json_chunk = json.dumps(
                gltf,
                ensure_ascii=False,
                separators=(",", ":")
            ).encode("utf-8")
            json_chunk += b" " * ((4 - len(json_chunk) % 4) % 4)
            rebuilt_length = total_length - original_json_length + len(json_chunk)

            target.write(struct.pack("<4sII", b"glTF", 2, rebuilt_length))
            target.write(struct.pack("<I4s", len(json_chunk), b"JSON"))
            target.write(json_chunk)
            shutil.copyfileobj(source, target, length=8 * 1024 * 1024)

        if os.path.getsize(temporary_path) != rebuilt_length:
            raise RuntimeError("写入配准信息后的 GLB 长度校验失败。")
        os.replace(temporary_path, glb_path)
    finally:
        if os.path.exists(temporary_path):
            os.remove(temporary_path)

def camera_calibration_dict(camera):
    try:
        c = camera.calibration or (camera.sensor.calibration if camera.sensor else None)
        if c is None:
            return None
        return {
            "camera_model": str(c.type),
            "width_px": int(c.width),
            "height_px": int(c.height),
            "f_px": float(c.f),
            "cx_px": float(c.cx),
            "cy_px": float(c.cy),
            "b1": float(c.b1),
            "b2": float(c.b2),
            "k1": float(c.k1),
            "k2": float(c.k2),
            "k3": float(c.k3),
            "k4": float(c.k4),
            "p1": float(c.p1),
            "p2": float(c.p2),
            "p3": float(c.p3),
            "p4": float(c.p4),
        }
    except Exception:
        return None

def model_texture_count(model):
    try:
        return len(model.textures)
    except Exception:
        return 0

def model_display_name(model):
    label = str(model.label).strip() if model.label is not None else ""
    return (label or "未命名模型") + "（key=" + str(model.key) + "）"

def metashape_version_tuple():
    numbers = [int(value) for value in re.findall(r"\d+", str(Metashape.app.version))[:3]]
    return tuple((numbers + [0, 0, 0])[:3])

def export_model_compatible(chunk, export_model_args):
    """Export while safely dropping optional keywords unknown to this Metashape build."""
    args = dict(export_model_args)
    omitted = []

    # Agisoft introduced this keyword in 2.1.1. Earlier glTF exports are Z-up.
    if metashape_version_tuple() >= (2, 1, 1):
        args["gltf_y_up"] = True
    else:
        omitted.append("gltf_y_up")
        print(
            "Metashape compatibility: gltf_y_up is unavailable in "
            + str(Metashape.app.version)
            + "; exporting Z-up and adding a Y-up GLB scene wrapper."
        )

    protected = {"path", "format", "model", "crs"}
    invalid_argument_markers = (
        "invalid argument",
        "unexpected keyword",
        "unknown argument",
        "无效的参数",
        "无效参数",
        "未知参数"
    )

    while True:
        try:
            chunk.exportModel(**args)
            return "gltf_y_up" in args, omitted
        except Exception as error:
            message = str(error)
            message_lower = message.lower()
            unsupported = None
            if any(marker in message_lower for marker in invalid_argument_markers):
                for name in sorted(args, key=len, reverse=True):
                    if name not in protected and name.lower() in message_lower:
                        unsupported = name
                        break
            if unsupported is None:
                raise

            args.pop(unsupported)
            omitted.append(unsupported)
            print(
                "Metashape compatibility: retrying export without unsupported argument "
                + unsupported
                + ". Original error: "
                + message
            )

def export_web_package():
    script_path = os.path.abspath(__file__) if "__file__" in globals() else "<Metashape console>"
    print("Running metashape_export_web_package.py " + SCRIPT_VERSION)
    print("Script path: " + script_path)

    doc = Metashape.app.document
    chunk = doc.chunk

    if chunk is None:
        Metashape.app.messageBox("没有活动 Chunk。")
        return

    if chunk.model is None:
        Metashape.app.messageBox("当前 Chunk 没有活动 3D Model。请先把要导出的模型设为当前模型。")
        return

    model = chunk.model
    source_texture_count = model_texture_count(model)
    if source_texture_count == 0:
        textured_models = [candidate for candidate in chunk.models if model_texture_count(candidate) > 0]
        candidate_text = "、".join(model_display_name(candidate) for candidate in textured_models)
        guidance = (
            "检测到有纹理的模型：" + candidate_text + "\n\n"
            if candidate_text
            else "当前 Chunk 没有检测到带纹理的 3D Model，请先执行“构建纹理”。\n\n"
        )
        Metashape.app.messageBox(
            "当前活动模型没有照片纹理：" + model_display_name(model) + "\n"
            "继续导出的 GLB 会显示为灰色。\n\n"
            + guidance
            + "请在 Workspace 的 3D Models 下双击带纹理的模型，将它设为活动模型后重新运行脚本。"
        )
        return

    if chunk.crs is None:
        Metashape.app.messageBox("当前 Chunk 没有地理坐标系。需要已经配准的 Chunk。")
        return

    T = chunk.transform.matrix
    if T is None:
        Metashape.app.messageBox("Chunk 没有有效 transform，无法建立绝对位置关系。")
        return

    source_geocentric = chunk.crs.geoccs
    if source_geocentric is None or WGS84_GEOCENTRIC is None:
        Metashape.app.messageBox(
            "当前 Chunk 坐标系没有可用的地心坐标系，无法转换到 WGS84。\n"
            "请先为 Chunk 设置有效的地理或投影坐标系并完成配准。"
        )
        return

    selected_markers = [m for m in chunk.markers if m.selected and m.position is not None]

    if len(selected_markers) > 1:
        Metashape.app.messageBox("检测到多个已选择 Marker。请只选择一个作为局部坐标原点。")
        return
    if len(selected_markers) == 1:
        origin_chunk = selected_markers[0].position
        origin_source = {"type": "selected_marker", "label": selected_markers[0].label}
    else:
        origin_chunk = chunk.region.center
        origin_source = {"type": "region_center", "label": None}

    origin_source_ecef = T.mulp(origin_chunk)
    origin_wgs84_ecef = point_to_wgs84_ecef(origin_source_ecef, source_geocentric)
    origin_wgs84 = WGS84.project(origin_wgs84_ecef)

    lon = float(origin_wgs84[0])
    lat = float(origin_wgs84[1])
    h = float(origin_wgs84[2])

    topo_wkt = build_topocentric_wkt(lon, lat, h)
    export_crs = Metashape.CoordinateSystem(topo_wkt)

    glb_path = Metashape.app.getSaveFileName(
        "导出 Web 模型包 - 选择 GLB 文件名",
        filter="Binary glTF (*.glb)"
    )
    if not glb_path:
        return

    if not glb_path.lower().endswith(".glb"):
        glb_path += ".glb"

    out_dir = os.path.dirname(glb_path) or os.getcwd()
    output_stem = os.path.splitext(os.path.basename(glb_path))[0]
    georef_path = os.path.join(out_dir, output_stem + ".georef.json")
    cameras_xml_path = os.path.join(out_dir, output_stem + ".cameras.xml")
    reference_csv_path = os.path.join(out_dir, output_stem + ".camera_reference.csv")
    cameras_json_path = os.path.join(out_dir, output_stem + ".cameras.json")

    export_model_args = {
        "path": glb_path,
        "format": Metashape.ModelFormatGLTF,
        "model": model.key,
        "crs": export_crs,
        "binary": True,
        "save_texture": True,
        "texture_format": Metashape.ImageFormatJPEG,
        "embed_texture": True,
        "save_uv": True,
        "save_normals": True,
        "save_colors": False,
        "save_confidence": False,
        "save_cameras": False,
        "save_markers": False,
        "save_udim": False,
        "save_alpha": False,
        "colors_rgb_8bit": True,
        "clip_to_boundary": False,
        "save_metadata_xml": False
    }
    metashape_native_y_up, omitted_export_arguments = export_model_compatible(
        chunk,
        export_model_args
    )
    appearance = inspect_glb_appearance(glb_path)
    if (
        appearance["textured_material_count"] == 0
        or appearance["texture_count"] == 0
        or appearance["image_count"] == 0
        or appearance["uv_primitive_count"] == 0
    ):
        Metashape.app.messageBox(
            "GLB 已生成，但检查发现照片纹理没有写入文件，因此停止生成 Web 模型包。\n\n"
            "活动模型：" + model_display_name(model) + "\n"
            "Metashape 模型纹理数：" + str(source_texture_count) + "\n"
            "GLB 材质/纹理/图片/UV："
            + str(appearance["material_count"]) + "/"
            + str(appearance["texture_count"]) + "/"
            + str(appearance["image_count"]) + "/"
            + str(appearance["uv_primitive_count"]) + "\n\n"
            "请确认活动模型使用 Textured 显示，并尝试在 Metashape 中手动导出一次带纹理 GLB。"
        )
        return

    chunk.exportCameras(
        path=cameras_xml_path,
        format=Metashape.CamerasFormatXML,
        save_points=False,
        save_markers=False,
        save_invalid_matches=False,
        use_initial_calibration=False
    )

    try:
        chunk.exportReference(
            path=reference_csv_path,
            format=Metashape.ReferenceFormatCSV,
            items=Metashape.ReferenceItemsCameras,
            columns="nxyzabcuvwdef",
            delimiter=",",
            precision=9,
            save_rotation=True,
            save_location_accuracy=True,
            save_rotation_accuracy=True,
            save_errors=True,
            save_estimated=True,
            save_variance=False,
            save_enabled=True
        )
    except Exception as e:
        print("camera_reference.csv export warning:", e)

    lam = math.radians(lon)
    phi = math.radians(lat)

    east_ecef = [-math.sin(lam), math.cos(lam), 0.0]
    north_ecef = [
        -math.sin(phi) * math.cos(lam),
        -math.sin(phi) * math.sin(lam),
        math.cos(phi)
    ]
    up_ecef = [
        math.cos(phi) * math.cos(lam),
        math.cos(phi) * math.sin(lam),
        math.sin(phi)
    ]

    gltf_to_ecef = [
        [east_ecef[0], up_ecef[0], -north_ecef[0], float(origin_wgs84_ecef[0])],
        [east_ecef[1], up_ecef[1], -north_ecef[1], float(origin_wgs84_ecef[1])],
        [east_ecef[2], up_ecef[2], -north_ecef[2], float(origin_wgs84_ecef[2])],
        [0.0, 0.0, 0.0, 1.0]
    ]

    georef = {
        "schema": "metashape-web-georef/1.1",
        "metashape_version": str(Metashape.app.version),
        "model_file": os.path.basename(glb_path),
        "model_label": model.label,
        "model_key": int(model.key),
        "source_chunk": {
            "label": chunk.label,
            "crs_authority": chunk.crs.authority if chunk.crs else None,
            "crs_wkt2": chunk.crs.wkt2 if chunk.crs else None,
            "geocentric_crs_wkt2": source_geocentric.wkt2,
            "chunk_transform_internal_to_source_geocentric": mat_to_list(T)
        },
        "local_frame": {
            "type": "topocentric_ENU",
            "unit": "metre",
            "origin_source": origin_source,
            "origin_wgs84": {
                "longitude_deg": lon,
                "latitude_deg": lat,
                "ellipsoidal_height_m": h
            },
            "origin_wgs84_ecef_m": vec3(origin_wgs84_ecef),
            "origin_source_geocentric_m": vec3(origin_source_ecef),
            "topocentric_wkt2": export_crs.wkt2,
            "enu_axes": {"x": "East", "y": "North", "z": "Up"}
        },
        "glb": {
            "gltf_y_up": True,
            "appearance": appearance,
            "metashape_omitted_export_arguments": omitted_export_arguments,
            "axis_conversion": (
                "metashape_gltf_y_up"
                if metashape_native_y_up
                else "web_package_z_up_scene_wrapper"
            ),
            "axes": {"x": "East", "y": "Up", "z": "-North"},
            "matrix_layout": "row-major",
            "vector_convention": "column-vector",
            "enu_to_gltf_yup": [
                [1.0, 0.0, 0.0, 0.0],
                [0.0, 0.0, 1.0, 0.0],
                [0.0, -1.0, 0.0, 0.0],
                [0.0, 0.0, 0.0, 1.0]
            ],
            "gltf_yup_to_ecef_m": gltf_to_ecef
        }
    }

    with open(georef_path, "w", encoding="utf-8") as f:
        json.dump(georef, f, ensure_ascii=False, indent=2)

    camera_ref_crs = chunk.camera_crs if chunk.camera_crs else chunk.crs
    cameras_out = []

    for camera in chunk.cameras:
        if camera.type != Metashape.Camera.Type.Regular:
            continue

        item = {
            "label": camera.label,
            "photo_filename": safe_photo_filename(camera),
            "aligned": bool(camera.transform),
            "calibration": camera_calibration_dict(camera),
            "camera_transform_chunk": mat_to_list(camera.transform) if camera.transform else None
        }

        if camera.transform:
            center_source_ecef = T.mulp(camera.center)
            center_wgs84_ecef = point_to_wgs84_ecef(center_source_ecef, source_geocentric)
            center_enu = export_crs.project(center_wgs84_ecef)
            center_wgs84 = WGS84.project(center_wgs84_ecef)
            item["estimated"] = {
                "wgs84": {
                    "longitude_deg": float(center_wgs84[0]),
                    "latitude_deg": float(center_wgs84[1]),
                    "ellipsoidal_height_m": float(center_wgs84[2])
                },
                "local_enu_m": vec3(center_enu),
                "glb_y_up_m": enu_to_gltf_yup(center_enu),
                "camera_to_glb_yup": camera_to_glb_yup_matrix(
                    camera,
                    T,
                    source_geocentric,
                    export_crs
                ),
                "camera_axes": {"x": "image-right", "y": "image-down", "z": "forward"},
                "matrix_layout": "row-major",
                "vector_convention": "column-vector"
            }

        if camera.reference.location is not None and camera_ref_crs is not None:
            try:
                ref_source_ecef = camera_ref_crs.unproject(camera.reference.location)
                ref_wgs84 = Metashape.CoordinateSystem.transform(
                    ref_source_ecef,
                    camera_ref_crs.geoccs,
                    WGS84
                )
                item["reference_gps"] = {
                    "wgs84": {
                        "longitude_deg": float(ref_wgs84[0]),
                        "latitude_deg": float(ref_wgs84[1]),
                        "ellipsoidal_height_m": float(ref_wgs84[2])
                    },
                    "rotation": vec3(camera.reference.rotation) if camera.reference.rotation is not None else None
                }
            except Exception as e:
                item["reference_gps_error"] = str(e)

        cameras_out.append(item)

    cameras_package = {
        "schema": "metashape-web-cameras/1.1",
        "coordinate_reference": os.path.basename(georef_path),
        "euler_angles": str(chunk.euler_angles),
        "camera_count": len(cameras_out),
        "cameras": cameras_out
    }
    with open(cameras_json_path, "w", encoding="utf-8") as f:
        json.dump(cameras_package, f, ensure_ascii=False, indent=2)

    web_package = {
        "schema": "metashape-web-package/1.0",
        "georef": georef,
        "cameras": cameras_package
    }
    inject_glb_web_package(
        glb_path,
        web_package,
        convert_z_up_to_y_up=not metashape_native_y_up
    )

    other_omitted_export_arguments = [
        name for name in omitted_export_arguments if name != "gltf_y_up"
    ]
    msg = (
        "导出完成（脚本版本 " + SCRIPT_VERSION + "）：\n\n"
        + os.path.basename(glb_path) + "\n"
        + os.path.basename(georef_path) + "\n"
        + os.path.basename(cameras_xml_path) + "\n"
        + os.path.basename(reference_csv_path) + "\n"
        + os.path.basename(cameras_json_path) + "\n\n"
        + "GLB 已内嵌 Web 配准和相机参数。\n"
        + "内嵌照片纹理：" + str(appearance["image_count"]) + " 张。\n"
        + (
            "当前 Metashape 不支持 gltf_y_up，脚本已自动完成 Y-up 兼容转换。\n"
            if not metashape_native_y_up
            else ""
        )
        + (
            "已忽略当前版本不支持的导出参数："
            + ", ".join(other_omitted_export_arguments)
            + "\n"
            if other_omitted_export_arguments
            else ""
        )
        + f"局部原点 WGS84：{lon:.9f}, {lat:.9f}, {h:.3f} m"
    )
    print(msg)
    Metashape.app.messageBox(msg)

export_web_package()
