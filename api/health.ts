interface ApiRequest {
  method?: string;
}

interface ApiResponse {
  status: (code: number) => ApiResponse;
  json: (data: unknown) => void;
}

export default function handler(_req: ApiRequest, res: ApiResponse) {
  res.status(200).json({
    status: "ok",
    platform: "vercel",
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
  });
}
