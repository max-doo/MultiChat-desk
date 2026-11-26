开启 Gemini API 的“推理模式”主要取决于所使用的模型版本。
推理专用模型
调用带有推理前缀的模型。
模型名称：gemini-2.0-flash-thinking-experimental
该模型设计用于处理复杂的推理任务。 
API 参数
对于支持自定义推理深度的模型，可以在请求的配置项中使用 thinking_level 参数。
配置参数：thinking_level
可选值：
high：最大化推理深度，适合复杂问题。
medium：平衡推理与响应速度。
low：最小化延迟，适合简单指令或聊天任务。
minimal：几乎不进行推理，仅执行基本任务。 
OpenAI 兼容接口
如果使用的是 OpenAI 格式的调用方式，可以通过 extra_body 传递推理参数： 
json
{
  "model": "gemini-3-pro",
  "messages": [{"role": "user", "content": "解决这个数学难题..."}],
  "extra_body": {
    "reasoning_effort": "high" 
  }
}
请谨慎使用此类代码。

获取推理过程
推理模式产生的“思考内容”通常位于返回对象的特定字段中（如 thought 或 reasoning_details）。
注意：部分模型可以通过设置 include_thoughts: true 来显式要求在响应中包含思考链。 