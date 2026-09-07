export function handleMetadata(_req: Request, capabilityJson: Record<string, unknown>): Response {
  return Response.json(capabilityJson, {
    status: 200,
    headers: {
      "Content-Type": "application/fhir+json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
