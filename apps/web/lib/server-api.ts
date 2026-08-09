export async function serverApi<T>(path: string): Promise<T> {
  const origin = process.env.API_ORIGIN || "http://localhost:4000";
  const response = await fetch(new URL(`/v1${path}`, origin), { cache: "no-store" });
  if (!response.ok) throw new Error(`API request failed with status ${response.status}`);
  return response.json() as Promise<T>;
}
