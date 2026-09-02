# sushi_bun

A FHIR R5 server powered by [Bun](https://bun.sh) and [FSH SUSHI](https://fshschool.org).

> **Not production-ready.** This is a development and prototyping tool. Use it to explore FHIR server design, test clients, or prototype APIs.

Write your FHIR server's contract in **FHIR Shorthand** (`.fsh` files). SUSHI compiles them to JSON. This server reads that JSON at startup and dynamically generates every route, handler, and search parameter — no hardcoded resource types, no static config files, no hand-written routes.

Resources are validated against StructureDefinitions on create, update, and batch entry processing. Invalid resources return `422` with an OperationOutcome.

**Change the FSH, restart the server, get a different API.**

## Quick Start

```bash
# Install dependencies
bun install

# Compile FSH → JSON
bun run build:sushi

# Start the server
bun run start
```

The server starts at `http://localhost:3000`. Hit `/metadata` to see what it can do.

## How It Works

```
┌─────────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│  input/fsh/*.fsh    │──────▶│   sushi build    │──────▶│ fsh-generated/   │
│  (your contract)    │       │                  │       │ resources/*.json │
└─────────────────────┘       └──────────────────┘       └────────┬─────────┘
                                                                  │
                                                                  ▼
┌─────────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│  curl localhost:3000│◀──────│   Bun.serve()    │◀──────│  CapabilityStmt  │
│  (FHIR responses)   │       │  (dynamic routes)│       │  → route config  │
└─────────────────────┘       └──────────────────┘       └──────────────────┘
```

1. You write `.fsh` files defining resources, interactions, search parameters, and operations
2. `sushi build` compiles them into FHIR JSON (CapabilityStatement, StructureDefinitions, etc.)
3. At startup, the server parses the CapabilityStatement into a `RouteConfig` and loads StructureDefinitions for validation
4. Routes are generated dynamically — only endpoints you declared exist
5. SQLite stores resources as JSON blobs with soft-delete and version history
6. On create/update, resources are validated against their StructureDefinition

## Example FSH

```fsh
Instance: MyCapabilityStatement
InstanceOf: CapabilityStatement
Usage: #definition
* kind = #instance
* status = #active
* date = "2026-08-31"
* fhirVersion = #5.0.0
* format[0] = #json
* rest.mode = #server

// Patient — full CRUD + search
* rest.resource[+].type = #Patient
* rest.resource[=].interaction[+].code = #read
* rest.resource[=].interaction[+].code = #create
* rest.resource[=].interaction[+].code = #update
* rest.resource[=].interaction[+].code = #delete
* rest.resource[=].interaction[+].code = #search-type
* rest.resource[=].searchParam[+].name = "name"
* rest.resource[=].searchParam[=].type = #string

// Observation — read only
* rest.resource[+].type = #Observation
* rest.resource[=].interaction[+].code = #read
* rest.resource[=].interaction[+].code = #search-type
```

Change the FSH, rebuild, restart — the server adapts.

## API

Once running, the server supports standard FHIR R5 REST interactions:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/metadata` | CapabilityStatement |
| `GET` | `/:type` | Search |
| `POST` | `/:type` | Create |
| `GET` | `/:type/:id` | Read |
| `PUT` | `/:type/:id` | Update |
| `DELETE` | `/:type/:id` | Delete |
| `GET` | `/:type/:id/_history` | Version history |
| `GET` | `/:type/:id/_history/:vid` | Read specific version |
| `POST` | `/` | Batch / Transaction |
| `POST` | `/:type/$everything` | Operation (if declared) |
| `POST` | `/:type/$validate` | Operation (if declared) |

Which endpoints actually exist depends entirely on what you declared in your FSH.

### Search

```bash
# Search patients by name
curl "http://localhost:3000/Patient?name=Smith"

# Search with pagination
curl "http://localhost:3000/Patient?_count=10&_offset=0"

# Search observations by code
curl "http://localhost:3000/Observation?code=8867-4"
```

### Create + Read

```bash
# Create a patient
curl -X POST http://localhost:3000/Patient \
  -H "Content-Type: application/fhir+json" \
  -d '{"resourceType":"Patient","name":[{"family":"Smith","given":["John"]}],"gender":"male","birthDate":"1990-01-15","identifier":[{"system":"http://example.org/mrn","value":"12345"}]}'

# Read it back (use the id from the response)
curl http://localhost:3000/Patient/<id>
```

### Batch / Transaction

```bash
curl -X POST http://localhost:3000/ \
  -H "Content-Type: application/fhir+json" \
  -d '{
    "resourceType": "Bundle",
    "type": "batch",
    "entry": [
      {"request":{"method":"POST","url":"Patient"},"resource":{"resourceType":"Patient","name":[{"family":"Alpha"}],"gender":"male","birthDate":"1985-01-01","identifier":[{"system":"http://example.org/mrn","value":"A1"}]}},
      {"request":{"method":"POST","url":"Patient"},"resource":{"resourceType":"Patient","name":[{"family":"Beta"}],"gender":"female","birthDate":"1990-05-20","identifier":[{"system":"http://example.org/mrn","value":"B2"}]}}
    ]
  }'
```

Transactions execute atomically (all-or-nothing). Batches execute entries independently. Both support `urn:uuid:` temporary ID resolution across entries. Each entry is validated against its StructureDefinition.

## Validation

Resources are validated against StructureDefinitions on create, update, and batch/transaction entry processing. The `$validate` operation provides explicit validation.

The validator checks:

- **Primitive types** — format validation for all 17 FHIR primitive types (string, integer, date, dateTime, uri, code, etc.)
- **Cardinality** — min/max constraints on all elements
- **Choice types** — ensures only one `[x]` variant is present
- **Fixed values** — elements with fixed values must match exactly
- **MustSupport** — required mustSupport elements must be present
- **FHIRPath constraints** — evaluates `constraint[].expression` on elements
- **Extensions** — validates structure (required `url`, absolute URLs, nesting depth)
- **Slicing** — discriminator-based slice validation, closed/open rules, per-slice cardinality
- **Terminology bindings** — code validation against ValueSet bindings (required/extensible/preferred)

```bash
# Explicit validation via $validate
curl -X POST http://localhost:3000/Patient/$validate \
  -H "Content-Type: application/fhir+json" \
  -d '{"resourceType":"Patient","name":[{"family":"Smith"}]}'
```


## Testing

```bash
bun test
```

## Project Structure

```
sushi_bun/
├── sushi-config.yaml                # Sushi config (FSHOnly: true, R5)
├── input/fsh/
│   ├── capability.fsh               # Server contract (resources, interactions, ops)
│   └── profiles/
│       └── patient.fsh              # MyPatient profile (strict validation)
├── fsh-generated/resources/         # Sushi output (gitignored)
├── src/
│   ├── index.ts                     # Entry point
│   ├── server.ts                    # Bun.serve() with dynamic routes
│   ├── db.ts                        # SQLite setup
│   ├── fhir/
│   │   ├── types.ts                 # FHIR type definitions
│   │   ├── capability.ts            # CapabilityStatement parser
│   │   ├── validator.ts             # Core validation engine
│   │   ├── validator-loader.ts      # StructureDefinition loader + registry
│   │   ├── bundle-validator.ts      # Bundle-specific validation
│   │   ├── extension/               # Extension structure validation
│   │   ├── fhirpath/                # FHIRPath lexer, parser, evaluator
│   │   ├── schema/                  # StructureDefinition merging
│   │   ├── slicing/                 # Element slicing validation
│   │   ├── terminology/             # ValueSet/CodeSystem binding checks
│   │   └── type-checker/            # Primitive, cardinality, choice type checks
│   ├── router/
│   │   ├── generator.ts             # RouteConfig → Bun routes
│   │   └── params.ts                # FHIR search param parsing
│   ├── handlers/                    # FHIR interaction handlers
│   └── store/
│       ├── types.ts                 # ResourceStore, StorageProvider interfaces
│       ├── resource-store.ts        # SQLite CRUD + versioning
│       └── sqlite-provider.ts       # Default SQLite provider
└── tests/                           # Bun test suite
```

## Dependencies

**Zero runtime dependencies.** The entire server runs on:

- `bun` — runtime + HTTP server + SQLite
- `fsh-sushi` — dev only, compiles FSH to JSON
- `fast-check` — dev only, property-based testing
- `@types/bun` — dev only, TypeScript types

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |

## Extending

### Add a new resource type

1. Edit `input/fsh/capability.fsh` and add a new `rest.resource` block
2. Run `bun run build:sushi`
3. Restart the server

### Add a new operation

1. Add an `operation` block to the relevant resource in `capability.fsh`
2. Rebuild and restart
3. Implement the handler in `src/handlers/operations.ts`

### Add a new search parameter

1. Add a `searchParam` block to the relevant resource in `capability.fsh`
2. Add the JSON path mapping in `src/store/sqlite-provider.ts` (`getSqlForParam`)
3. Rebuild and restart

### Bring your own handlers

Override any FHIR interaction by passing a `handlers` object to `createServer`. Only override what you need — the rest use the built-in defaults.

```typescript
import { defaultHandlers } from "./src/handlers/default.ts";

const baseHandlers = await defaultHandlers(); // default SQLite store
const { server } = await createServer({
  capabilityPath: "capability.json",
  handlers: {
    ...baseHandlers,
    handleSearch(req, config) {
      // custom search logic — store is already bound
    },
  },
});
```

Each handler receives the request and the resource config. See `src/handlers/` for the default implementations.

### Bring your own storage

Implement the `ResourceStore` interface for your backend and a `FilterTranslator` to convert FHIR search parameters to your query format.

```typescript
import type { ResourceStore, StorageProvider } from "./src/store/types.ts";

const store: ResourceStore = {
  create(resourceType, resource) { /* ... */ },
  read(resourceType, id) { /* ... */ },
  readVersion(resourceType, id, versionId) { /* ... */ },
  update(resourceType, id, resource, expectedVersion?) { /* ... */ },
  softDelete(resourceType, id) { /* ... */ },
  listVersions(resourceType, id) { /* ... */ },
  search(resourceType, filters, offset?, limit?) { /* ... */ },
  count(resourceType, filters) { /* ... */ },
  transaction<T>(fn) { return fn(); },
};

const provider: StorageProvider = {
  createStore() { return store; },
  translateFilters(filters, searchParams) { /* ... */ },
};

const handlers = await defaultHandlers(store, undefined, provider.translateFilters);
const { server } = await createServer({ capabilityPath: "capability.json", handlers });
```

See `src/store/sqlite-provider.ts` for the reference implementation.

## License

MIT
