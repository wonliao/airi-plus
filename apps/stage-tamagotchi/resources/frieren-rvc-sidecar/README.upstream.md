# 芙莉莲 RVC 桥接服务

这是一个给 AIRI 或其他 OpenAI 兼容客户端使用的本地语音桥接服务。

整体流程是：

1. 用 Kokoro 生成基础 TTS
2. 把基础语音送进 RVC
3. 输出芙莉莲音色的最终语音

## 服务接口

本服务提供这些接口：

- `GET /health`
- `GET /v1/models`
- `GET /v1/audio/voices`
- `POST /v1/dual/text`
- `POST /v1/dual/speech`
- `POST /v1/audio/speech`

## 当前架构

```text
文字
-> LLM 生成 display_text + speech_text
-> display_text 给前端显示
-> speech_text 给 Kokoro TTS
-> 基础 wav
-> RVC 芙莉莲模型
-> 最终 wav/mp3/flac/opus
```

如果你只想继续用旧接口，也可以直接调用：

```text
文字
-> Kokoro TTS
-> 基础 wav
-> RVC 芙莉莲模型
-> 最终 wav/mp3/flac/opus
```

## 当前版本的重要特性

- 以 OpenAI 兼容 speech API 形式提供服务
- 以 GPU 模式运行
- 启动时预载芙莉莲 RVC 模型
- 启动时预载 HuBERT
- 启动时预热 RMVPE
- 将 `.index` 检索文件缓存到内存
- 已启用 CORS，可供 AIRI 网页设置界面直接调用
- 可选接入 LLM，把中文显示文本转换成日文发声文本

## 需要的模型文件

挂载到模型目录中的文件应包含：

- `Frieren_e720_s6480.pth`
- `added_IVF280_Flat_nprobe_1_Frieren_v2.index`

容器内默认路径：

- `/data/models/Frieren_e720_s6480.pth`
- `/data/models/added_IVF280_Flat_nprobe_1_Frieren_v2.index`

服务启动时如果缺少 RVC 基础资产，会自动下载：

- `hubert_base.pt`
- `rmvpe.pt`

## 一键启动

先复制环境变量模板：

```bash
cp .env.example .env
```

如果你就是在 `atom` 上使用目前这套目录结构，通常不需要改 `.env`。

如果你要启用“中文显示、日文发声”模式，至少还要填：

```bash
DUAL_LLM_API_KEY=你的_API_Key
DUAL_LLM_MODEL=gpt-4.1-mini
```

然后直接启动：

```bash
./start.sh
```

停止服务：

```bash
./stop.sh
```

重启服务：

```bash
./restart.sh
```

查看状态：

```bash
./status.sh
```

## 无 Docker 本机运行

如果你是在 Apple Silicon macOS 上直跑，目前已经验证过一套可工作的本机方案。

目前主用方案就是：

- `KOKORO_SYNTH_MODE=embedded`
- 只启动 `frieren-rvc-bridge :8010`
- `RVC` 保持 subprocess

双服务 `Kokoro-FastAPI :8880 + bridge :8010` 只作为备用或对照量测方案。

### 本机实测可用配置

- `KOKORO_SYNTH_MODE=embedded`
- `FORCE_RVC_DEVICE=cpu`
- `RVC_F0_METHOD=pm`
- `RVC_EXECUTION_MODE=subprocess`
- `RVC_INDEX_RATE=0`

说明：

- `rmvpe` 在这台本机上会导致推理崩溃
- `.index` 检索在本机 `faiss` 路径上会触发 segmentation fault
- `embedded` 模式会把 Kokoro 直接放进 bridge 主进程
- RVC 仍然走 subprocess，所以 `fairseq/faiss` 不会在主 bridge 进程常驻
- 所以本机模式默认优先求稳定，而不是完全复现 Docker/GPU 配置

### 本机安装

```bash
cd /Users/ben/AI_Project/Kokoro-Frieren/frieren-rvc-bridge
./setup-local.sh
```

这个脚本会：

- 建立 `.venv-local`
- 安装 `fairseq==0.12.2`
- 安装 `av==11.0.0`
- 安装 `rvc==0.3.5`
- 安装 `praat-parselmouth`
- 安装内嵌 Kokoro 所需依赖
- 准备 UniDic 日文字典
- 验证关键模块 import

### 本机启动

```bash
cd /Users/ben/AI_Project/Kokoro-Frieren/frieren-rvc-bridge
./run-local.sh
```

启动后可检查：

```bash
curl http://127.0.0.1:8010/health
```

### 本机注意事项

- `run-local.sh` 默认走 `KOKORO_SYNTH_MODE=embedded`
- 在这个模式下，不需要额外先启动 `Kokoro-FastAPI :8880`
- 如果你想保留旧的双服务模式，可以改成 `KOKORO_SYNTH_MODE=http`
- `run-local.sh` 会优先读取 `.env.local`
- 如果要调用 `/v1/dual/text` 或 `/v1/dual/speech`，请把 OpenAI 相关配置写进 `.env.local`
- 本机模式的音色细节可能不如 Linux GPU + index 检索版本

建议的 `.env.local` 结构如下：

```dotenv
KOKORO_SYNTH_MODE=embedded
KOKORO_PROJECT_DIR=/Users/ben/AI_Project/Kokoro-Frieren/Kokoro-FastAPI
KOKORO_DEFAULT_VOICE=jf_alpha
DUAL_LLM_BASE_URL=https://api.openai.com/v1
DUAL_LLM_API_KEY=你的金钥
DUAL_LLM_MODEL=gpt-4.1-mini
FORCE_RVC_DEVICE=cpu
RVC_F0_METHOD=pm
RVC_INDEX_RATE=0
RVC_WORKDIR=/Users/ben/AI_Project/rvc-workdir
RVC_ASSETS_DIR=/Users/ben/AI_Project/rvc-assets
RVC_MODEL_PATH=/Users/ben/AI_Project/models/frieren_rvc/Frieren_e720_s6480.pth
RVC_INDEX_PATH=/Users/ben/AI_Project/models/frieren_rvc/added_IVF280_Flat_nprobe_1_Frieren_v2.index
```

README 不直接写入完整 API key；实际本机可用值请放在你自己的 `.env.local`。

启动脚本会自动做这些事：

- 检查模型与 `.index` 文件是否存在
- 自动建立工作目录与资产目录
- 预设启用 `KOKORO_SYNTH_MODE=embedded`
- 预设启用 `RVC_EXECUTION_MODE=subprocess`
- 用 `uvicorn` 直接启动本机 bridge

`restart.sh` 会先停掉旧容器，再重新启动并等待预热完成。

`status.sh` 会显示：

- `docker compose ps`
- 本机 `/health` 检查结果
- 最近 40 行容器日志

### 主用模式记忆体实测

截至 `2026-04-12`，这台机器上的单服务 `embedded` 模式，已经用 `10` 轮长时间重启式测试统计：

| 状态 | 记忆体 |
| --- | ---: |
| 冷启动待机 | 平均约 `65.8 MB` |
| 跑过一次 `/v1/audio/speech` | 平均约 `663.9 MB` |
| 跑过一次 `/v1/dual/speech` | 平均约 `677.0 MB` |

补充：

- 冷启动样本：`65.8 / 65.8 / 65.7 / 65.7 / 65.8 / 65.8 / 65.8 / 65.8 / 65.8 / 65.7`
- `audio/speech` 后样本：`664.1 / 663.8 / 663.8 / 663.9 / 663.8 / 664.3 / 664.3 / 663.9 / 663.8 / 663.7`
- `dual/speech` 后样本：`679.2 / 676.0 / 678.2 / 678.9 / 679.4 / 676.6 / 677.4 / 674.0 / 676.0 / 674.0`
- 优点是只需要维护 `:8010` 一个服务
- 而且这次 `10` 轮统计里，跑过请求后的总 RSS 也稳定低于双服务 low-memory 模式
- 详细原始数据可参考 [memory-benchmark-10trials-longrun-20260412-113335.json](/Users/ben/AI_Project/Kokoro-Frieren/test-output/memory-benchmark-10trials-longrun-20260412-113335.json)

如果要改成更长时间统计，现在可直接运行：

```bash
python3 /Users/ben/AI_Project/Kokoro-Frieren/measure-memory.py
python3 /Users/ben/AI_Project/Kokoro-Frieren/measure-memory.py 10
```

说明：

- 默认是 `5` 轮
- `10` 轮适合做长时间量测
- 报告文件名会自动带上轮数与时间戳

## 手动构建镜像

```bash
docker build -t frieren-rvc-bridge:gpu-persistent .
```

## 手动启动服务

下面是目前在 `atom` 上使用的启动命令：

```bash
docker run -d \
  --name frieren-rvc-bridge \
  --restart unless-stopped \
  --gpus all \
  -p 8010:8010 \
  -e KOKORO_BASE_URL=http://host.docker.internal:8880/v1 \
  -v ~/AI_PROJECTS/models/frieren_rvc:/data/models \
  -v ~/AI_PROJECTS/rvc-workdir:/data/rvc-workdir \
  -v ~/AI_PROJECTS/rvc-assets:/data/rvc-assets \
  --add-host=host.docker.internal:host-gateway \
  frieren-rvc-bridge:gpu-persistent
```

## AIRI 设置方式

在 AIRI 中请选择：

- `OpenAI 兼容性`

并填写：

- `Base URL`: `http://192.168.50.136:8010/v1`
- `Model`: `frieren-rvc`
- `Voice`: `frieren`

补充说明：

- `API Key` 可填写任意非空字符串，例如 `dummy`
- `使用自訂 SSML` 请关闭
- 建议输入日文文本

如果是在 `atom` 上给 AIRI 使用，目前可直接填：

- `Base URL`: `http://192.168.50.136:8010/v1`
- `Model`: `frieren-rvc`
- `Voice`: `frieren`

## 请求示例

### 1. 旧版直接语音接口

```bash
curl -X POST http://192.168.50.136:8010/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "frieren-rvc",
    "input": "こんにちは。今日は静かに話します。",
    "voice": "frieren",
    "response_format": "wav",
    "speed": 0.95
  }' \
  --output frieren.wav
```

### 2. 只生成双文本

```bash
curl -X POST http://192.168.50.136:8010/v1/dual/text \
  -H 'Content-Type: application/json' \
  -d '{
    "input": "今天先慢慢来吧。"
  }'
```

回传示例：

```json
{
  "display_text": "今天先慢慢来吧。",
  "speech_text": "今日はゆっくりいこう。"
}
```

### 3. 一次取得双文本与语音

```bash
curl -X POST http://192.168.50.136:8010/v1/dual/speech \
  -H 'Content-Type: application/json' \
  -d '{
    "input": "今天先慢慢来吧。",
    "voice": "frieren",
    "response_format": "mp3",
    "speed": 0.95
  }'
```

回传内容包含：

- `display_text`
- `speech_text`
- `audio_base64`
- `audio_format`
- `media_type`

本机已验证：

- `/v1/dual/text` 可正常回传 JSON
- `/v1/dual/speech` 可正常回传 `audio_base64`
- 解码后的输出音档为有效 `WAV / 48000 Hz`

## 可用环境变量

- `KOKORO_BASE_URL`
- `KOKORO_DEFAULT_VOICE`
- `DUAL_LLM_BASE_URL`
- `DUAL_LLM_API_KEY`
- `DUAL_LLM_MODEL`
- `DUAL_LLM_TIMEOUT`
- `DUAL_LLM_CACHE_SIZE`
- `DUAL_LLM_CACHE_TTL_SECONDS`
- `RVC_WORKDIR`
- `RVC_ASSETS_DIR`
- `RVC_MODEL_PATH`
- `RVC_INDEX_PATH`
- `RVC_HUBERT_URL`
- `RVC_RMVPE_URL`
- `RVC_WARMUP_TEXT`

## 性能说明

当前 `atom` 上的版本行为如下：

- 服务启动会比较慢，因为会先做模型加载与预热
- 预热完成后，第一句就接近热机速度
- 短句的热机延迟大约可到亚秒级

## 常见问题

### 1. AIRI 显示 `Failed to fetch`

通常是浏览器跨域或预检请求问题。当前版本已经启用 CORS。

### 2. 为什么突然又变慢

先检查容器是否仍然以 `--gpus all` 运行。

### 3. 声音不对或不像芙莉莲

优先检查：

- 模型文件是否正确挂载
- `.index` 文件是否正确挂载
- 输入文本是否为自然日文

### 4. 为什么启动后不能立刻访问

因为当前版本会在启动阶段做预热，只有预热完成后才会进入可用状态。

### 5. `/v1/dual/text` 或 `/v1/dual/speech` 报错

优先检查：

- `.env` 中是否填写了 `DUAL_LLM_API_KEY`
- `DUAL_LLM_BASE_URL` 是否正确
- `DUAL_LLM_MODEL` 是否是可用模型
