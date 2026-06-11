import json
from pathlib import Path

import numpy as np
from pygltflib import GLTF2

from common import DATA_DIR, pick_category, read_json, utc_now, write_json


COMPONENT_DTYPE = {
    5120: np.int8,
    5121: np.uint8,
    5122: np.int16,
    5123: np.uint16,
    5125: np.uint32,
    5126: np.float32,
}

TYPE_COMPONENTS = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
    "MAT2": 4,
    "MAT3": 9,
    "MAT4": 16,
}


def as_dict(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            loaded = json.loads(value)
            return loaded if isinstance(loaded, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def find_meta_value(payload, keys):
    if not isinstance(payload, dict):
        return None
    for key in keys:
        if key in payload and payload[key] not in (None, ""):
            return payload[key]
    for value in payload.values():
        if isinstance(value, dict):
            found = find_meta_value(value, keys)
            if found not in (None, ""):
                return found
    return None


def read_accessor(gltf, blob, accessor_index):
    accessor = gltf.accessors[accessor_index]
    if accessor.bufferView is None:
        return None
    view = gltf.bufferViews[accessor.bufferView]
    dtype = COMPONENT_DTYPE[accessor.componentType]
    components = TYPE_COMPONENTS[accessor.type]
    offset = (view.byteOffset or 0) + (accessor.byteOffset or 0)
    item_size = np.dtype(dtype).itemsize * components
    stride = view.byteStride or item_size
    if stride == item_size:
        array = np.frombuffer(blob, dtype=dtype, count=accessor.count * components, offset=offset)
        return array.reshape((accessor.count, components)).astype(np.float64)
    rows = []
    for row_index in range(accessor.count):
        start = offset + row_index * stride
        row = np.frombuffer(blob, dtype=dtype, count=components, offset=start)
        rows.append(row)
    return np.asarray(rows, dtype=np.float64)


def node_matrix(node):
    if node.matrix:
        return np.array(node.matrix, dtype=np.float64).reshape((4, 4)).T
    matrix = np.identity(4)
    if node.translation:
        matrix[:3, 3] = np.array(node.translation, dtype=np.float64)
    if node.rotation:
        x, y, z, w = node.rotation
        rotation = np.array(
            [
                [1 - 2 * y * y - 2 * z * z, 2 * x * y - 2 * z * w, 2 * x * z + 2 * y * w, 0],
                [2 * x * y + 2 * z * w, 1 - 2 * x * x - 2 * z * z, 2 * y * z - 2 * x * w, 0],
                [2 * x * z - 2 * y * w, 2 * y * z + 2 * x * w, 1 - 2 * x * x - 2 * y * y, 0],
                [0, 0, 0, 1],
            ],
            dtype=np.float64,
        )
        matrix = matrix @ rotation
    if node.scale:
        matrix = matrix @ np.diag([node.scale[0], node.scale[1], node.scale[2], 1])
    return matrix


def point_in_polygon(point, polygon):
    x, z = point
    inside = False
    previous = polygon[-1]
    for current in polygon:
        xi, zi = current
        xj, zj = previous
        intersects = (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / ((zj - zi) or 1e-12) + xi
        if intersects:
            inside = not inside
        previous = current
    return inside


def classify_zone(center, zones):
    for zone in zones:
        if point_in_polygon(center, zone["points"]):
            return zone["id"]
    return "unassigned"


def iter_scene_nodes(gltf):
    roots = set()
    for scene in gltf.scenes:
        for node_index in scene.nodes or []:
            roots.add(node_index)
    if not roots:
        roots = set(range(len(gltf.nodes)))

    def visit(node_index, parent_matrix):
        node = gltf.nodes[node_index]
        world = parent_matrix @ node_matrix(node)
        yield node_index, node, world
        for child_index in node.children or []:
            yield from visit(child_index, world)

    for root in sorted(roots):
        yield from visit(root, np.identity(4))


def primitive_positions(gltf, blob, primitive):
    position_index = primitive.attributes.POSITION
    if position_index is None:
        return None
    positions = read_accessor(gltf, blob, position_index)
    if positions is None:
        return None
    return positions[:, :3]


def primitive_bounds(gltf, blob, primitive):
    position_index = primitive.attributes.POSITION
    if position_index is None:
        return None
    accessor = gltf.accessors[position_index]
    if accessor.min and accessor.max:
        return np.asarray(accessor.min[:3], dtype=np.float64), np.asarray(accessor.max[:3], dtype=np.float64)
    positions = read_accessor(gltf, blob, position_index)
    if positions is None or not len(positions):
        return None
    return positions[:, :3].min(axis=0), positions[:, :3].max(axis=0)


def bounds_corners(minimum, maximum):
    return np.asarray(
        [
            [minimum[0], minimum[1], minimum[2]],
            [minimum[0], minimum[1], maximum[2]],
            [minimum[0], maximum[1], minimum[2]],
            [minimum[0], maximum[1], maximum[2]],
            [maximum[0], minimum[1], minimum[2]],
            [maximum[0], minimum[1], maximum[2]],
            [maximum[0], maximum[1], minimum[2]],
            [maximum[0], maximum[1], maximum[2]],
        ],
        dtype=np.float64,
    )


def generate(
    glb_path=DATA_DIR / "raw" / "Airport1.glb",
    zones_path=DATA_DIR / "rules" / "zone_definitions.json",
    rules_path=DATA_DIR / "rules" / "mapping_rules.json",
    output_path=DATA_DIR / "generated" / "model_blocks.json",
):
    rules = read_json(rules_path)
    zones_payload = read_json(zones_path)
    zones = zones_payload["zones"]
    gltf = GLTF2().load_binary(str(glb_path))
    blob = gltf.binary_blob()
    mesh_vertices = {}
    blocks = {}
    meshes = {}
    unassigned_meshes = []
    unclassified_meshes = []
    mesh_counter = 0

    for node_index, node, world_matrix in iter_scene_nodes(gltf):
        if node.mesh is None:
            continue
        mesh = gltf.meshes[node.mesh]
        all_corners = []
        for primitive in mesh.primitives:
            primitive_bound = primitive_bounds(gltf, blob, primitive)
            if primitive_bound is not None:
                all_corners.append(bounds_corners(*primitive_bound))
        if not all_corners:
            continue
        local_corners = np.vstack(all_corners)
        ones = np.ones((local_corners.shape[0], 1))
        world_positions = np.hstack([local_corners, ones]) @ world_matrix.T
        minimum = world_positions[:, :3].min(axis=0)
        maximum = world_positions[:, :3].max(axis=0)
        center = (minimum + maximum) / 2

        node_extras = as_dict(node.extras)
        mesh_extras = as_dict(mesh.extras)
        element_id = find_meta_value(node_extras, ["ElementID", "elementId", "UniqueId", "uniqueId"])
        if element_id is None:
            element_id = find_meta_value(mesh_extras, ["ElementID", "elementId", "UniqueId", "uniqueId"])
        name = node.name or mesh.name or "未命名构件"
        mesh_id = str(element_id) if element_id not in (None, "") else f"mesh-{mesh_counter}-{name}"
        if mesh_id in meshes:
            mesh_id = f"{mesh_id}-{node_index}"
        category = pick_category(name, rules["glb_name_rules"])
        zone = classify_zone([float(center[0]), float(center[2])], zones)
        block_id = f"{zone}|{category}"

        mesh_record = {
            "mesh_id": mesh_id,
            "element_id": str(element_id) if element_id not in (None, "") else None,
            "name": name,
            "node_index": node_index,
            "zone": zone,
            "category": category,
            "block_id": block_id,
            "center": [round(float(center[0]), 3), round(float(center[1]), 3), round(float(center[2]), 3)],
            "bbox_min": [round(float(v), 3) for v in minimum],
            "bbox_max": [round(float(v), 3) for v in maximum],
        }
        meshes[mesh_id] = mesh_record
        block = blocks.setdefault(
            block_id,
            {
                "block_id": block_id,
                "zone": zone,
                "category": category,
                "mesh_count": 0,
                "mesh_ids": [],
            },
        )
        block["mesh_count"] += 1
        block["mesh_ids"].append(mesh_id)
        if zone == "unassigned":
            unassigned_meshes.append(mesh_record)
        if category == "未分类":
            unclassified_meshes.append(mesh_record)
        mesh_counter += 1

    payload = {
        "generated_at": utc_now(),
        "source_model": Path(glb_path).name,
        "coordinate_system": zones_payload.get("coordinate_system", "three_world_xz"),
        "assignment_strategy": zones_payload.get("assignment_strategy", "mesh_center_point"),
        "summary": {
            "mesh_count": len(meshes),
            "block_count": len(blocks),
            "unassigned_mesh_count": len(unassigned_meshes),
            "unclassified_mesh_count": len(unclassified_meshes),
        },
        "blocks": dict(sorted(blocks.items())),
        "meshes": meshes,
        "unassigned_meshes": unassigned_meshes,
        "unclassified_meshes": unclassified_meshes,
    }
    write_json(output_path, payload)
    return payload


if __name__ == "__main__":
    result = generate()
    print(json.dumps(result["summary"], ensure_ascii=False, indent=2))
