import { createServer } from "./server.ts";

async function main() {
  const capabilityPath = "fsh-generated/resources/CapabilityStatement-MyCapabilityStatement.json";

  const { server, config } = await createServer({
    port: Number(process.env.PORT) || 3000,
    capabilityPath,
  });

  console.log(`FHIR R5 server running at ${server.url}`);
  console.log(`Supported resources: ${[...config.resources.keys()].join(", ")}`);
  console.log(`System interactions: ${[...config.systemInteractions].join(", ")}`);

  for (const [type, rc] of config.resources) {
    console.log(`  ${type}: ${[...rc.interactions].join(", ")}`);
    if (rc.searchParams.size > 0) {
      console.log(`    search params: ${[...rc.searchParams.keys()].join(", ")}`);
    }
  }
}

main().catch(console.error);
