// Observation search parameters

Instance: Observation-patient
InstanceOf: SearchParameter
Usage: #definition
* url = "http://example.org/fhir/SearchParameter/Observation-patient"
* name = "Observation-patient"
* status = #active
* description = "Who and/or what the observation is about"
* code = #patient
* base[0] = #Observation
* type = #reference
* expression = "Observation.subject.reference"

Instance: Observation-code
InstanceOf: SearchParameter
Usage: #definition
* url = "http://example.org/fhir/SearchParameter/Observation-code"
* name = "Observation-code"
* status = #active
* description = "Describes what was observed"
* code = #code
* base[0] = #Observation
* type = #token
* expression = "Observation.code"

Instance: Observation-status
InstanceOf: SearchParameter
Usage: #definition
* url = "http://example.org/fhir/SearchParameter/Observation-status"
* name = "Observation-status"
* status = #active
* description = "The status of the observation result"
* code = #status
* base[0] = #Observation
* type = #token
* expression = "Observation.status"
