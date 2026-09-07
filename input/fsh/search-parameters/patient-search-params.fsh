// Patient search parameters

Instance: Patient-name
InstanceOf: SearchParameter
Usage: #definition
* url = "http://example.org/fhir/SearchParameter/Patient-name"
* name = "Patient-name"
* status = #active
* description = "A server defined search that may match any of the string fields in the HumanName"
* code = #name
* base[0] = #Patient
* type = #string
* expression = "Patient.name"

Instance: Patient-family
InstanceOf: SearchParameter
Usage: #definition
* url = "http://example.org/fhir/SearchParameter/Patient-family"
* name = "Patient-family"
* status = #active
* description = "A portion of the family name of the patient"
* code = #family
* base[0] = #Patient
* type = #string
* expression = "Patient.name.family"

Instance: Patient-given
InstanceOf: SearchParameter
Usage: #definition
* url = "http://example.org/fhir/SearchParameter/Patient-given"
* name = "Patient-given"
* status = #active
* description = "A portion of the given name of the patient"
* code = #given
* base[0] = #Patient
* type = #string
* expression = "Patient.name.given"

Instance: Patient-gender
InstanceOf: SearchParameter
Usage: #definition
* url = "http://example.org/fhir/SearchParameter/Patient-gender"
* name = "Patient-gender"
* status = #active
* description = "Gender of the patient"
* code = #gender
* base[0] = #Patient
* type = #token
* expression = "Patient.gender"

Instance: Patient-birthdate
InstanceOf: SearchParameter
Usage: #definition
* url = "http://example.org/fhir/SearchParameter/Patient-birthdate"
* name = "Patient-birthdate"
* status = #active
* description = "The patient's date of birth"
* code = #birthdate
* base[0] = #Patient
* type = #date
* expression = "Patient.birthDate"

Instance: Patient-identifier
InstanceOf: SearchParameter
Usage: #definition
* url = "http://example.org/fhir/SearchParameter/Patient-identifier"
* name = "Patient-identifier"
* status = #active
* description = "A patient identifier"
* code = #identifier
* base[0] = #Patient
* type = #token
* expression = "Patient.identifier"
