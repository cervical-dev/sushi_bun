import { validateResource } from "../../src/fhir/validator.ts";
import type { StructureDefinition } from "../../src/fhir/types.ts";

const patientSD: StructureDefinition = {
  resourceType: "StructureDefinition",
  id: "Patient",
  url: "http://hl7.org/fhir/StructureDefinition/Patient",
  type: "Patient",
  differential: {
    element: [
      { id: "Patient.identifier", path: "Patient.identifier", min: 0, max: "*" },
      { id: "Patient.identifier.system", path: "Patient.identifier.system", type: [{ code: "uri" }], min: 0, max: "1" },
      { id: "Patient.identifier.value", path: "Patient.identifier.value", type: [{ code: "string" }], min: 0, max: "1" },
      { id: "Patient.name", path: "Patient.name", min: 0, max: "*" },
      { id: "Patient.name.family", path: "Patient.name.family", type: [{ code: "string" }], min: 0, max: "1" },
      { id: "Patient.name.given", path: "Patient.name.given", type: [{ code: "string" }], min: 0, max: "*" },
      { id: "Patient.gender", path: "Patient.gender", type: [{ code: "code" }], min: 0, max: "1" },
      { id: "Patient.birthDate", path: "Patient.birthDate", type: [{ code: "date" }], min: 0, max: "1" },
      { id: "Patient.active", path: "Patient.active", type: [{ code: "boolean" }], min: 0, max: "1" },
    ],
  },
};

const fullPatient = {
  resourceType: "Patient",
  identifier: [
    { system: "http://example.org/mrn", value: "12345" },
    { system: "http://example.org/ssn", value: "67890" },
  ],
  name: [
    { family: "Smith", given: ["John", "Robert"], use: "official" },
    { family: "S", given: ["Johnny"], use: "nickname" },
  ],
  gender: "male",
  birthDate: "1990-01-15",
  active: true,
};

const iterations = 10_000;
const start = performance.now();
for (let i = 0; i < iterations; i++) {
  validateResource(fullPatient, patientSD);
}
const elapsed = performance.now() - start;
const perValidation = elapsed / iterations;
const throughput = Math.round(iterations / (elapsed / 1000));

console.log(`Validated ${iterations.toLocaleString()} resources in ${elapsed.toFixed(1)}ms`);
console.log(`Per validation: ${perValidation.toFixed(4)}ms`);
console.log(`Throughput: ${throughput.toLocaleString()} validations/sec`);

const memBefore = process.memoryUsage().heapUsed;
for (let i = 0; i < 1000; i++) {
  validateResource(fullPatient, patientSD);
}
const memAfter = process.memoryUsage().heapUsed;
const memDelta = (memAfter - memBefore) / 1024;
console.log(`Memory delta after 1000 validations: ${memDelta.toFixed(1)}KB`);

if (perValidation < 1) {
  console.log("PASS: Per-validation time < 1ms target");
} else {
  console.log(`WARN: Per-validation time ${perValidation.toFixed(2)}ms exceeds 1ms target`);
}
