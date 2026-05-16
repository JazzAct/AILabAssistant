from openai import OpenAI

client = OpenAI(
  base_url = "https://integrate.api.nvidia.com/v1",
  api_key = "$NVIDIA_API_KEY"
)

completion = client.chat.completions.create(
  model="nvidia/usdcode-llama-3.1-70b-instruct",
  messages=[{"role":"user","content":""}],
  temperature=0.1,
  top_p=1,
  max_tokens=1024,
  extra_body={"expert_type":"auto"},
  stream=False
)

print(completion.choices[0].message)

