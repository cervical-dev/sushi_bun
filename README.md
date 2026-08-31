# sushi_bun

A FHIR R5 server powered by [Bun](https://bun.sh) and [FSH SUSHI](https://fshschool.org).

Write your FHIR server's contract in **FHIR Shorthand** (`.fsh` files). SUSHI compiles them to JSON. This server reads that JSON at startup and dynamically generates every route, handler, and search parameter — no hardcoded resource types, no static config files, no hand-written routes.

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
3. At startup, the server parses the CapabilityStatement into a `RouteConfig`
4. Routes are generated dynamically — only endpoints you declared exist
5. SQLite stores resources as JSON blobs with version history

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

## Testing

```bash
bun test
```

The test suite covers:

- **Unit tests**: CapabilityStatement parsing, route generation, search parameter handling, SQLite store operations
- **Integration tests**: Full HTTP request/response cycles against a running server, verifying that the server only exposes routes declared in the CapabilityStatement

```
74 tests passing
├── Unit
│   ├── capability.test.ts    # Parse CapabilityStatement → config
│   ├── store.test.ts         # SQLite CRUD + versioning
│   ├── generator.test.ts     # Config → route map
│   └── params.test.ts        # Search parameter parsing
└── Integration
    ├── routing.test.ts       # CapabilityStatement drives routing
    ├── crud.test.ts          # Create, read, update, delete
    ├── search.test.ts        # Search with filters + pagination
    ├── batch.test.ts         # Batch + transaction bundles
    ├── metadata.test.ts      # CapabilityStatement endpoint
    └── operations.test.ts    # $everything, $validate
```

## Project Structure

```
sushi_bun/
├── sushi-config.yaml          # Sushi config (FSHOnly: true, R5)
├── input/fsh/
│   ├── capability.fsh         # Server contract (resources, interactions, ops)
│   └── profiles/
│       └── patient.fsh        # Profile definitions
├── fsh-generated/resources/   # Sushi output (gitignored)
├── src/
│   ├── index.ts               # Entry point
│   ├── server.ts              # Bun.serve() with dynamic routes
│   ├── db.ts                  # SQLite setup
│   ├── fhir/
│   │   ├── types.ts           # Minimal FHIR interfaces
│   │   └── capability.ts      # CapabilityStatement parser
│   ├── router/
│   │   ├── generator.ts       # RouteConfig → Bun routes
│   │   └── params.ts          # Search param → SQL filters
│   ├── handlers/              # FHIR interaction handlers
│   └── store/
│       └── resource-store.ts  # SQLite CRUD + versioning
└── tests/                     # Bun test suite
```

## Dependencies

**Zero runtime dependencies.** The entire server runs on:

- `bun` — runtime + HTTP server + SQLite
- `fsh-sushi` — dev only, compiles FSH to JSON
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
2. Add the JSON path mapping in `src/router/params.ts` (`getSqlForParam`)
3. Rebuild and restart

## License

MIT
