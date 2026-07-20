import { AI_PROVIDERS } from "@/shared/constants/providers";
import { getSettings } from "@/lib/localDb";
import { authorizeApiKey, extractApiKey, getProviderCredentials } from "@/sse/services/auth.js";
import { VOICE_FETCHERS, fetchElevenLabsVoices } from "open-sse/handlers/ttsCore.js";

const CORS = { "Access-Control-Allow-Origin": "*" };

export async function OPTIONS() {
  return new Response(null, { headers: { ...CORS, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");
    const lang = searchParams.get("lang");
    const supported = new Set(["elevenlabs", "deepgram", "inworld", "edge-tts", "local-device"]);
    if (!supported.has(provider)) {
      return Response.json({ error: { message: `provider must be one of: ${[...supported].join(", ")}` } }, { status: 400, headers: CORS });
    }

    const settings = await getSettings();
    const authorization = await authorizeApiKey(extractApiKey(request) || searchParams.get("key"), settings.requireApiKey, request);
    if (!authorization.allowed) return Response.json({ error: { message: authorization.message } }, { status: authorization.status, headers: CORS });

    let voices;
    if (provider === "edge-tts" || provider === "local-device") {
      const raw = await VOICE_FETCHERS[provider]();
      voices = raw.map((voice) => ({
        id: voice.id || voice.ShortName,
        name: voice.name || voice.FriendlyName || voice.ShortName,
        lang: voice.lang || voice.Locale?.split("-")[0] || "",
        gender: voice.gender || voice.Gender || "",
      }));
    } else {
      const credentials = await getProviderCredentials(provider, null, null, {
        allowedConnectionIds: authorization.apiKey?.allowedConnectionIds,
      });
      if (!credentials || credentials.allRateLimited) {
        return Response.json({ error: { message: `No permitted ${provider} connection` } }, { status: 404, headers: CORS });
      }
      if (provider === "elevenlabs") {
        voices = (await fetchElevenLabsVoices(credentials.apiKey)).map((voice) => ({
          id: voice.voice_id, name: voice.name, lang: voice.labels?.language || "en", gender: voice.labels?.gender || "",
        }));
      } else {
        const url = provider === "deepgram" ? "https://api.deepgram.com/v1/models" : "https://api.inworld.ai/tts/v1/voices";
        const headers = provider === "deepgram"
          ? { Authorization: `Token ${credentials.apiKey}` }
          : { Authorization: `Basic ${credentials.apiKey}` };
        const response = await fetch(url, { headers });
        if (!response.ok) return Response.json({ error: { message: `${provider} voice API failed` } }, { status: 502, headers: CORS });
        const data = await response.json();
        voices = provider === "deepgram"
          ? (data.tts || []).map((voice) => ({ id: voice.canonical_name || voice.name, name: voice.name || voice.canonical_name, lang: voice.languages?.[0] || "en", gender: "" }))
          : (data.voices || []).map((voice) => ({ id: voice.voiceId, name: voice.displayName || voice.voiceId, lang: voice.languages?.[0] || "en", gender: voice.gender || "" }));
      }
    }

    if (lang) voices = voices.filter((voice) => voice.lang === lang);
    const alias = AI_PROVIDERS[provider]?.alias || provider;
    return Response.json({ object: "list", data: voices.map((voice) => ({ ...voice, model: `${alias}/${voice.id}` })) }, { headers: CORS });
  } catch (error) {
    return Response.json({ error: { message: error.message || "Failed" } }, { status: 502, headers: CORS });
  }
}
