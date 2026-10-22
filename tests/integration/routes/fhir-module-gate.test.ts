/**
 * `/api/fhir/*` and the `doctorReport` module, against the real database and
 * through the real API kit.
 *
 * The FHIR face serves the same whole-record aggregate as the document
 * export, down to the decrypted insurance number on the Patient resource, so
 * it answers to the same module. A whole-record export has no truthful partial
 * answer: with the module off every data route, search and read alike,
 * refuses with the shared 403 `module.disabled` envelope and none of the
 * record leaves; the static CapabilityStatement carries no user data and
 * stays reachable. The module is switched the way the settings switch it,
 * through the stored per-account preferences.
 *
 * The registry declares no 403 for these operations; the refusals below skip
 * the contract check for that reason.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { GET as METADATA } from "@/app/api/fhir/metadata/route";
import { GET as PATIENT_SEARCH } from "@/app/api/fhir/Patient/route";
import { GET as PATIENT_READ } from "@/app/api/fhir/Patient/[id]/route";
import { GET as EVERYTHING } from "@/app/api/fhir/Patient/$everything/route";
import { GET as OBSERVATION_SEARCH } from "@/app/api/fhir/Observation/route";
import { GET as OBSERVATION_READ } from "@/app/api/fhir/Observation/[id]/route";
import { GET as STATEMENT_SEARCH } from "@/app/api/fhir/MedicationStatement/route";
import { GET as STATEMENT_READ } from "@/app/api/fhir/MedicationStatement/[id]/route";
import { GET as ADMINISTRATION_SEARCH } from "@/app/api/fhir/MedicationAdministration/route";
import { GET as ADMINISTRATION_READ } from "@/app/api/fhir/MedicationAdministration/[id]/route";
import { GET as COVERAGE_SEARCH } from "@/app/api/fhir/Coverage/route";
import { GET as COVERAGE_READ } from "@/app/api/fhir/Coverage/[id]/route";
import { encrypt } from "@/lib/crypto";
import { FHIR_READ_SCOPE } from "@/lib/fhir/rest";
import { MODULE_DISABLED_ERROR_CODE } from "@/lib/modules/gate";

import { callRoute, type RouteAuth } from "../../kit/call-route";
import {
  makeMeasurement,
  makeMedication,
  makeSession,
  makeToken,
  makeUser,
} from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();

const INSURANCE_NUMBER = "A123456789";
const MODULE_OFF_SKIP =
  "the FHIR operations declare no 403; the module gate's module.disabled envelope is undocumented on them";

type Handler = Parameters<typeof callRoute>[0];

/** Every data route, by the path a caller hits; the reads name a held id. */
const DATA_ROUTES: ReadonlyArray<{
  handler: Handler;
  route: string;
  params?: { id: string };
}> = [
  { handler: PATIENT_SEARCH, route: "/api/fhir/Patient" },
  { handler: COVERAGE_SEARCH, route: "/api/fhir/Coverage" },
  { handler: OBSERVATION_SEARCH, route: "/api/fhir/Observation" },
  { handler: STATEMENT_SEARCH, route: "/api/fhir/MedicationStatement" },
  {
    handler: ADMINISTRATION_SEARCH,
    route: "/api/fhir/MedicationAdministration",
  },
  { handler: EVERYTHING, route: "/api/fhir/Patient/$everything" },
  {
    handler: PATIENT_READ,
    route: "/api/fhir/Patient/{id}",
    params: { id: "patient-1" },
  },
  {
    handler: COVERAGE_READ,
    route: "/api/fhir/Coverage/{id}",
    params: { id: "coverage-1" },
  },
  {
    handler: OBSERVATION_READ,
    route: "/api/fhir/Observation/{id}",
    params: { id: "obs-1" },
  },
  {
    handler: STATEMENT_READ,
    route: "/api/fhir/MedicationStatement/{id}",
    params: { id: "med-1" },
  },
  {
    handler: ADMINISTRATION_READ,
    route: "/api/fhir/MedicationAdministration/{id}",
    params: { id: "medadmin-1" },
  },
];

beforeEach(async () => {
  await truncateAllTables(prisma);
});

/** An account whose saved selection reaches every routed resource type. */
async function seedOwner(doctorReport: boolean) {
  const now = Date.now();
  const user = await makeUser({
    fullName: "Sample Patient",
    insurerName: "Example Insurer",
    insuranceNumberEncrypted: encrypt(INSURANCE_NUMBER),
    reportSelectionJson: {
      v: 2,
      leaves: [
        "PATIENT_IDENTITY",
        "INSURANCE",
        "WEIGHT",
        "MEDICATION_LIST",
        "MEDICATION_ADMINISTRATIONS",
      ],
    },
    modulePreferencesJson: doctorReport ? {} : { doctorReport: false },
  });
  await makeMeasurement(user, {
    value: 79.5,
    measuredAt: new Date(now - 24 * 60 * 60 * 1000),
  });
  const medication = await makeMedication(user, {
    name: "Example Drug",
    createdAt: new Date(now - 30 * 24 * 60 * 60 * 1000),
  });
  const takenAt = new Date(now - 24 * 60 * 60 * 1000);
  await prisma.medicationIntakeEvent.create({
    data: {
      userId: user.id,
      medicationId: medication.id,
      scheduledFor: takenAt,
      takenAt,
    },
  });
  return user;
}

async function callEach(auth: RouteAuth, skip: boolean) {
  const results = [];
  for (const { handler, route, params } of DATA_ROUTES) {
    const res = await callRoute(handler, {
      method: "GET",
      route,
      params,
      auth,
      contract: skip ? { skip: MODULE_OFF_SKIP } : undefined,
    });
    results.push({ route, res });
  }
  return results;
}

describe("/api/fhir/* and the doctorReport module", () => {
  it("refuses every data route with module.disabled while the module is off, and none of the record leaves", async () => {
    const owner = await seedOwner(false);

    for (const auth of [
      await makeToken(owner, { permissions: [FHIR_READ_SCOPE] }),
      await makeSession(owner),
    ]) {
      for (const { route, res } of await callEach(auth, true)) {
        expect(res.status, route).toBe(403);
        expect(res.data, route).toBeNull();
        expect(res.meta, route).toMatchObject({
          errorCode: MODULE_DISABLED_ERROR_CODE,
          module: "doctorReport",
        });
        const body = JSON.stringify(res.body);
        for (const stored of [INSURANCE_NUMBER, "Sample Patient", "79.5"]) {
          expect(body, route).not.toContain(stored);
        }
      }
    }
  });

  it("serves every data route once the module is on", async () => {
    const owner = await seedOwner(true);
    const auth = await makeToken(owner, { permissions: [FHIR_READ_SCOPE] });

    for (const { route, res } of await callEach(auth, false)) {
      expect(res.status, route).toBe(200);
      expect(res.headers.get("content-type"), route).toContain(
        "application/fhir+json",
      );
    }
  });

  it("leaves the CapabilityStatement reachable while the module is off", async () => {
    const owner = await seedOwner(false);

    const res = await callRoute(METADATA, {
      method: "GET",
      route: "/api/fhir/metadata",
      auth: await makeToken(owner, { permissions: [FHIR_READ_SCOPE] }),
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ resourceType: "CapabilityStatement" });
  });
});
