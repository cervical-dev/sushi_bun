export const fullCapability = {
  resourceType: "CapabilityStatement" as const,
  kind: "instance" as const,
  status: "active" as const,
  date: "2026-08-31",
  fhirVersion: "5.0.0",
  format: ["json"],
  rest: [
    {
      mode: "server",
      resource: [
        {
          type: "Patient",
          interaction: [
            { code: "read" },
            { code: "search-type" },
            { code: "create" },
            { code: "update" },
            { code: "delete" },
            { code: "patch" },
            { code: "history-instance" },
            { code: "history-type" },
          ],
          versioning: "versioned-update",
          readHistory: true,
          updateCreate: true,
          conditionalCreate: true,
          conditionalRead: "full-support",
          conditionalUpdate: true,
          conditionalDelete: "single",
          searchParam: [
            { name: "name", type: "string" },
            { name: "family", type: "string" },
            { name: "given", type: "string" },
            { name: "gender", type: "token" },
            { name: "birthdate", type: "date" },
            { name: "identifier", type: "token" },
          ],
          operation: [
            { name: "validate", definition: "http://hl7.org/fhir/OperationDefinition/Resource-validate" },
          ],
        },
        {
          type: "Observation",
          interaction: [
            { code: "read" },
            { code: "search-type" },
            { code: "create" },
            { code: "update" },
            { code: "delete" },
            { code: "history-instance" },
            { code: "history-type" },
          ],
          searchParam: [
            { name: "patient", type: "reference" },
            { name: "code", type: "token" },
            { name: "status", type: "token" },
          ],
        },
      ],
      interaction: [
        { code: "transaction" },
        { code: "batch" },
        { code: "history-system" },
      ],
    },
  ],
};

export const readOnlyCapability = {
  resourceType: "CapabilityStatement" as const,
  kind: "instance" as const,
  status: "active" as const,
  date: "2026-08-31",
  fhirVersion: "5.0.0",
  format: ["json"],
  rest: [
    {
      mode: "server",
      resource: [
        {
          type: "Patient",
          interaction: [
            { code: "read" },
            { code: "search-type" },
          ],
          searchParam: [
            { name: "name", type: "string" },
            { name: "gender", type: "token" },
          ],
        },
      ],
      interaction: [],
    },
  ],
};

export const noHistoryCapability = {
  resourceType: "CapabilityStatement" as const,
  kind: "instance" as const,
  status: "active" as const,
  date: "2026-08-31",
  fhirVersion: "5.0.0",
  format: ["json"],
  rest: [
    {
      mode: "server",
      resource: [
        {
          type: "Patient",
          interaction: [
            { code: "read" },
            { code: "search-type" },
            { code: "create" },
            { code: "update" },
            { code: "delete" },
          ],
          searchParam: [
            { name: "name", type: "string" },
            { name: "gender", type: "token" },
          ],
        },
      ],
      interaction: [{ code: "batch" }],
    },
  ],
};

export const noUpdateCreateCapability = {
  resourceType: "CapabilityStatement" as const,
  kind: "instance" as const,
  status: "active" as const,
  date: "2026-08-31",
  fhirVersion: "5.0.0",
  format: ["json"],
  rest: [
    {
      mode: "server",
      resource: [
        {
          type: "Patient",
          interaction: [
            { code: "read" },
            { code: "search-type" },
            { code: "create" },
            { code: "update" },
            { code: "delete" },
            { code: "patch" },
            { code: "history-instance" },
            { code: "history-type" },
          ],
          versioning: "versioned-update",
          readHistory: true,
          updateCreate: false,
          searchParam: [
            { name: "name", type: "string" },
            { name: "family", type: "string" },
            { name: "given", type: "string" },
            { name: "gender", type: "token" },
            { name: "birthdate", type: "date" },
            { name: "identifier", type: "token" },
          ],
        },
      ],
      interaction: [
        { code: "transaction" },
        { code: "batch" },
        { code: "history-system" },
      ],
    },
  ],
};

export const noCreateCapability = {
  resourceType: "CapabilityStatement" as const,
  kind: "instance" as const,
  status: "active" as const,
  date: "2026-08-31",
  fhirVersion: "5.0.0",
  format: ["json"],
  rest: [
    {
      mode: "server",
      resource: [
        {
          type: "Patient",
          interaction: [
            { code: "read" },
            { code: "search-type" },
            { code: "update" },
            { code: "delete" },
          ],
          searchParam: [
            { name: "name", type: "string" },
            { name: "gender", type: "token" },
          ],
        },
      ],
      interaction: [],
    },
  ],
};
