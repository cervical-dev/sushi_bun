Profile: MyPatient
Parent: Patient
Id: my-patient
Title: "My Custom Patient"
Description: "A patient profile with additional constraints"
* identifier 1..* MS
* identifier.system 1..1
* identifier.value 1..1
* name 1..* MS
* name.family 1..1 MS
* name.given 1..* MS
* gender 1..1 MS
* birthDate 1..1 MS
* address MS
* telecom MS
