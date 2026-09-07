# sushi_bun

A FHIR R5 server powered by [Bun](https://bun.sh) and [FSH SUSHI](https://fshschool.org).

> **Not production-ready.** This is a development and prototyping tool. Use it to explore FHIR server design, test clients, or prototype APIs.

Write your FHIR server's contract in **FHIR Shorthand** (`.fsh` files). SUSHI compiles them to JSON. This server reads that JSON at startup and generates every route, handler, and search parameter dynamically. No hardcoded resource types. No static config files.

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
2. `sushi build` compiles them into FHIR JSON (CapabilityStatement, StructureDefinitions, SearchParameters, etc.)
3. At startup, the server parses the CapabilityStatement into a `RouteConfig` and loads StructureDefinitions for validation
4. Routes are generated dynamically. Only endpoints you declared exist.
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
* rest.resource[=].interaction[+].code = #patch
* rest.resource[=].interaction[+].code = #search-type
* rest.resource[=].searchParam[+].name = "family"
* rest.resource[=].searchParam[=].type = #string

// Observation — read only
* rest.resource[+].type = #Observation
* rest.resource[=].interaction[+].code = #read
* rest.resource[=].interaction[+].code = #search-type
```

Search parameters are data-driven: each one links to a `SearchParameter` resource (also written in FSH, in `input/fsh/search-parameters/`) whose FHIRPath `expression` the server resolves into a query automatically. No SQL mapping code required.

Change the FSH, rebuild, restart. The server adapts.

## API

Once running, the server supports standard FHIR R5 REST interactions:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/metadata` | CapabilityStatement |
| `GET` | `/:type` | Search |
| `POST` | `/:type/_search` | Search |
| `POST` | `/:type` | Create |
| `GET` | `/:type/:id` | Read |
| `PUT` | `/:type/:id` | Update |
| `PATCH` | `/:type/:id` | Update (JSON Patch) |
| `DELETE` | `/:type/:id` | Delete |
| `GET` | `/:type/:id/_history` | Version history |
| `GET` | `/:type/:id/_history/:vid` | Read specific version |
| `GET` | `/:type/_history` | Type-level history |
| `GET` | `/_history` | System-level history |
| `POST` | `/` | Batch / Transaction |
| `POST` | `/:type/$everything` | Operation (if declared) |
| `POST` | `/:type/$validate` | Operation (if declared) |

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

Transactions execute atomically (all-or-nothing). Batches run entries independently. Both resolve `urn:uuid:` references across entries and validate each one against its StructureDefinition.

## Validation

The `$validate` operation provides explicit validation outside of create/update/batch flows. The validator checks primitive types, cardinality, choice types, fixed values, MustSupport elements, FHIRPath constraints, extension structure, slicing, and terminology bindings.

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

The suite covers unit, API, and property-based (fast-check fuzz) tests.

## Dependencies

**Zero runtime dependencies.** Everything runs on `bun`; `fsh-sushi` and `fast-check` are dev-only.

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

1. Add a `SearchParameter` instance in `input/fsh/search-parameters/` with a FHIRPath `expression`
2. Reference it from the resource's `searchParam` block in `capability.fsh`
3. Rebuild and restart

### Bring your own handlers or storage

Pass a `handlers` object to `createServer` to override any FHIR interaction; the rest use the built-in defaults (see `src/handlers/types.ts`). To use a different backend, implement the `ResourceStore` and `StorageProvider` interfaces in `src/store/types.ts` — the SQLite provider is the reference implementation.

## License

MIT
