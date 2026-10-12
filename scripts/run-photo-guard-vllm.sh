#!/usr/bin/env bash
set -Eeuo pipefail

guard_root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

guard_env_value() {
  local guard_key="$1"
  local guard_env_file
  for guard_env_file in "$guard_root_dir/.env.local" "$guard_root_dir/.env"; do
    if [ ! -f "$guard_env_file" ]; then
      continue
    fi
    awk -F= -v key="$guard_key" '
      $0 !~ /^[[:space:]]*#/ && $1 == key {
        sub(/^[^=]*=/, "")
        print
        exit
      }
    ' "$guard_env_file" | sed 's/^["'\'']//; s/["'\'']$//'
    if grep -qE "^${guard_key}=" "$guard_env_file"; then
      return 0
    fi
  done
}

guard_value_or_default() {
  local guard_key="$1"
  local guard_default="$2"
  local guard_value
  guard_value="$(guard_env_value "$guard_key")"
  printf '%s' "${guard_value:-$guard_default}"
}

guard_vllm_executable="$(
  guard_value_or_default PHOTO_GUARD_VLLM_EXECUTABLE \
    /home/szcay/.venvs/vllm/bin/vllm
)"
guard_model_path="$(
  guard_value_or_default PHOTO_GUARD_MODEL_PATH \
    /opt/models/Qwen3-VL-2B-Instruct-FP8
)"
guard_model_name="$(
  guard_value_or_default PHOTO_GUARD_MODEL \
    qwen3-vl-2b-photo-guard
)"
guard_cuda_devices="$(
  guard_value_or_default PHOTO_GUARD_CUDA_VISIBLE_DEVICES 0
)"
guard_port="$(guard_value_or_default PHOTO_GUARD_PORT 9006)"
guard_gpu_memory="$(
  guard_value_or_default PHOTO_GUARD_GPU_MEMORY_UTILIZATION 0.16
)"
guard_max_sequences="$(
  guard_value_or_default PHOTO_GUARD_MAX_NUM_SEQS 8
)"
guard_max_model_length="$(
  guard_value_or_default PHOTO_GUARD_MAX_MODEL_LEN 4096
)"

if [ ! -x "$guard_vllm_executable" ]; then
  echo "PHOTO_GUARD_VLLM_EXECUTABLE is not executable: $guard_vllm_executable" >&2
  exit 1
fi
if [ ! -f "$guard_model_path/config.json" ]; then
  echo "PHOTO_GUARD_MODEL_PATH is not a complete model directory: $guard_model_path" >&2
  exit 1
fi

export CUDA_VISIBLE_DEVICES="$guard_cuda_devices"
export HF_HUB_OFFLINE=1
export OMP_NUM_THREADS=1
export TRANSFORMERS_OFFLINE=1
export VLLM_USE_DEEP_GEMM=0
export VLLM_USE_FLASHINFER_SAMPLER=0

exec "$guard_vllm_executable" serve "$guard_model_path" \
  --served-model-name "$guard_model_name" \
  --host 127.0.0.1 \
  --port "$guard_port" \
  --tensor-parallel-size 1 \
  --gpu-memory-utilization "$guard_gpu_memory" \
  --max-model-len "$guard_max_model_length" \
  --max-num-seqs "$guard_max_sequences" \
  --limit-mm-per-prompt.image 1 \
  --limit-mm-per-prompt.video 0 \
  --generation-config vllm \
  --trust-remote-code
