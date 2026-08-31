Instance: MyCapabilityStatement
InstanceOf: CapabilityStatement
Usage: #definition
* kind = #instance
* status = #active
* date = "2026-08-31"
* fhirVersion = #5.0.0
* format[0] = #json
* rest.mode = #server
* rest.documentation = "Example FHIR R5 Server"

// Patient resource with full CRUD + search
* rest.resource[+].type = #Patient
* rest.resource[=].interaction[+].code = #read
* rest.resource[=].interaction[+].code = #search-type
* rest.resource[=].interaction[+].code = #create
* rest.resource[=].interaction[+].code = #update
* rest.resource[=].interaction[+].code = #delete
* rest.resource[=].interaction[+].code = #history-instance
* rest.resource[=].versioning = #versioned-update
* rest.resource[=].readHistory = true
* rest.resource[=].updateCreate = true
* rest.resource[=].conditionalCreate = true
* rest.resource[=].conditionalRead = #full-support
* rest.resource[=].conditionalUpdate = true
* rest.resource[=].conditionalDelete = #single
* rest.resource[=].searchParam[+].name = "name"
* rest.resource[=].searchParam[=].type = #string
* rest.resource[=].searchParam[=].documentation = "A server defined search that may match any of the string fields in the HumanName"
* rest.resource[=].searchParam[+].name = "family"
* rest.resource[=].searchParam[=].type = #string
* rest.resource[=].searchParam[=].documentation = "A portion of the family name of the patient"
* rest.resource[=].searchParam[+].name = "given"
* rest.resource[=].searchParam[=].type = #string
* rest.resource[=].searchParam[=].documentation = "A portion of the given name of the patient"
* rest.resource[=].searchParam[+].name = "gender"
* rest.resource[=].searchParam[=].type = #token
* rest.resource[=].searchParam[=].documentation = "Gender of the patient"
* rest.resource[=].searchParam[+].name = "birthdate"
* rest.resource[=].searchParam[=].type = #date
* rest.resource[=].searchParam[=].documentation = "The patient's date of birth"
* rest.resource[=].searchParam[+].name = "identifier"
* rest.resource[=].searchParam[=].type = #token
* rest.resource[=].searchParam[=].documentation = "A patient identifier"
* rest.resource[=].operation[+].name = "everything"
* rest.resource[=].operation[=].definition = "http://hl7.org/fhir/OperationDefinition/Patient-everything"
* rest.resource[=].operation[+].name = "validate"
* rest.resource[=].operation[=].definition = "http://hl7.org/fhir/OperationDefinition/Resource-validate"

// Observation resource — read + search only (no create/update/delete)
* rest.resource[+].type = #Observation
* rest.resource[=].interaction[+].code = #read
* rest.resource[=].interaction[+].code = #search-type
* rest.resource[=].searchParam[+].name = "patient"
* rest.resource[=].searchParam[=].type = #reference
* rest.resource[=].searchParam[=].documentation = "Who and/or what the observation is about"
* rest.resource[=].searchParam[+].name = "code"
* rest.resource[=].searchParam[=].type = #token
* rest.resource[=].searchParam[=].documentation = "Describes what was observed"
* rest.resource[=].searchParam[+].name = "status"
* rest.resource[=].searchParam[=].type = #token
* rest.resource[=].searchParam[=].documentation = "The status of the observation result"

// System-level interactions
* rest.interaction[+].code = #transaction
* rest.interaction[+].code = #batch
