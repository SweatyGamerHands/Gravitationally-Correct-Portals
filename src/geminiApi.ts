export type GeminiProxyRequest = {
  model?: string;
  contents: unknown[];
  generationConfig?: unknown;
  safetySettings?: unknown;
  tools?: unknown;
  systemInstruction?: unknown;
};

export async function callGeminiViaBackend(payload: GeminiProxyRequest) {
  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini proxy error (${response.status}): ${errorBody}`);
  }

  return response.json();
}
