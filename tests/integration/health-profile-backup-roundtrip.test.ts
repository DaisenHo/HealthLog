import { Buffer } from "node:buffer";

import { beforeEach, describe, expect, it } from "vitest";

process.env.ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { encryptToBytes } from "@/lib/ai/coach/bytes-codec";
import { buildFullBackupPayload } from "@/lib/export/full-backup-payload";
import { restoreProfileData } from "@/lib/export/profile-backup";
import { restoreSensitiveData } from "@/lib/export/sensitive-backup";
import { parseBackupPayload } from "@/lib/validations/backup";
import { getPrismaClient, truncateAllTables } from "./setup";

beforeEach(async () => {
  await truncateAllTables(getPrismaClient());
});

async function seedProfile() {
  const prisma = getPrismaClient();
  const user = await prisma.user.create({
    data: {
      username: "profile-roundtrip",
      email: "profile-roundtrip@example.test",
      role: "USER",
    },
  });
  const emergencyContactsCiphertext = encryptToBytes(
    "ICE contact, reachable on the recorded number",
  );
  await prisma.userHealthProfile.create({
    data: {
      id: "profile-roundtrip-row",
      userId: user.id,
      aboutMeEncrypted: encryptToBytes("Works rotating shifts"),
      conditionsEncrypted: encryptToBytes("Asthma"),
      aiIncludedSections: ["CONDITIONS", "SMOKING_STATUS", "SHIFT_SCHEDULE"],
      // Emergency profile: three plaintext enums + three encrypted columns.
      emergencyBloodType: "O_NEG",
      organDonorStatus: "YES",
      advanceDirectiveStatus: "EXISTS",
      emergencyContactsEncrypted: emergencyContactsCiphertext,
      emergencyImplantsEncrypted: encryptToBytes("Pacemaker fitted 2021"),
      emergencyNoteEncrypted: encryptToBytes("Reacts to contrast dye"),
    },
  });

  const currentCiphertext = encryptToBytes("FORMER");
  await prisma.healthProfileFactRevision.create({
    data: {
      id: "smoking-current",
      userId: user.id,
      kind: "SMOKING_STATUS",
      valueEncrypted: currentCiphertext,
      validFrom: new Date("2026-07-10T00:00:00.000Z"),
      provenance: "USER_CORRECTION",
    },
  });
  await prisma.healthProfileFactRevision.create({
    data: {
      id: "smoking-prior",
      userId: user.id,
      kind: "SMOKING_STATUS",
      valueEncrypted: encryptToBytes("CURRENT"),
      validFrom: new Date("2026-07-01T00:00:00.000Z"),
      validUntil: new Date("2026-07-10T00:00:00.000Z"),
      provenance: "USER_REPORTED",
      supersededByRevisionId: "smoking-current",
    },
  });
  await prisma.healthProfileFactRevision.create({
    data: {
      id: "shift-current",
      userId: user.id,
      kind: "SHIFT_SCHEDULE",
      valueEncrypted: encryptToBytes("ROTATING"),
      validFrom: new Date("2026-07-05T00:00:00.000Z"),
      provenance: "USER_REPORTED",
    },
  });

  return { user, currentCiphertext, emergencyContactsCiphertext };
}

describe("health profile disaster-recovery round trip", () => {
  it("restores deleted encrypted profile rows and effective-dated history", async () => {
    const prisma = getPrismaClient();
    const { user, currentCiphertext, emergencyContactsCiphertext } =
      await seedProfile();
    const built = await buildFullBackupPayload(prisma, user.id, {
      purpose: "disaster-recovery",
    });
    const payload = parseBackupPayload(
      JSON.parse(JSON.stringify(built.payload)),
    );

    expect(payload.healthProfileFacts).toHaveLength(3);
    expect(
      payload.healthProfileFacts.every((fact) => fact.value === null),
    ).toBe(true);
    expect(
      payload.healthProfileFacts.every(
        (fact) => typeof fact.valueEncrypted === "string",
      ),
    ).toBe(true);

    await prisma.healthProfileFactRevision.deleteMany({
      where: { userId: user.id },
    });
    await prisma.userHealthProfile.deleteMany({ where: { userId: user.id } });
    expect(
      await prisma.healthProfileFactRevision.count({
        where: { userId: user.id },
      }),
    ).toBe(0);
    expect(
      await prisma.userHealthProfile.count({ where: { userId: user.id } }),
    ).toBe(0);

    await prisma.$transaction((tx) => restoreProfileData(tx, user.id, payload));

    const profile = await prisma.userHealthProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(profile.aiIncludedSections).toEqual([
      "CONDITIONS",
      "SMOKING_STATUS",
      "SHIFT_SCHEDULE",
    ]);

    // Every emergency column has to survive the round trip. The three enums
    // come back by value; the three encrypted columns come back as ciphertext,
    // and the contact column decrypts to exactly what was seeded. Dropping any
    // one of the six from the profile backup builder turns the matching
    // assertion red naming that column.
    expect(profile.emergencyBloodType).toBe("O_NEG");
    expect(profile.organDonorStatus).toBe("YES");
    expect(profile.advanceDirectiveStatus).toBe("EXISTS");
    expect(profile.emergencyContactsEncrypted).not.toBeNull();
    expect(profile.emergencyImplantsEncrypted).not.toBeNull();
    expect(profile.emergencyNoteEncrypted).not.toBeNull();
    expect(Buffer.from(profile.emergencyContactsEncrypted!)).toEqual(
      Buffer.from(emergencyContactsCiphertext),
    );

    const revisions = await prisma.healthProfileFactRevision.findMany({
      where: { userId: user.id },
      orderBy: { validFrom: "asc" },
    });
    expect(revisions).toHaveLength(3);
    const prior = revisions.find((row) => row.id === "smoking-prior");
    const current = revisions.find((row) => row.id === "smoking-current");
    expect(prior?.validUntil).toEqual(new Date("2026-07-10T00:00:00.000Z"));
    expect(prior?.supersededByRevisionId).toBe("smoking-current");
    expect(current?.validUntil).toBeNull();
    expect(Buffer.from(current!.valueEncrypted)).toEqual(
      Buffer.from(currentCiphertext),
    );
  });

  it("cascades every profile revision when the account is deleted", async () => {
    const prisma = getPrismaClient();
    const { user } = await seedProfile();

    await prisma.user.delete({ where: { id: user.id } });

    expect(
      await prisma.healthProfileFactRevision.count({
        where: { userId: user.id },
      }),
    ).toBe(0);
    expect(
      await prisma.userHealthProfile.count({ where: { userId: user.id } }),
    ).toBe(0);
  });

  it("carries the life circumstances both ways: new kinds, new AI sections, AUDIT-C (v1.43)", async () => {
    const prisma = getPrismaClient();
    const user = await prisma.user.create({
      data: {
        username: "life-roundtrip",
        email: "life-roundtrip@example.test",
        role: "USER",
      },
    });
    await prisma.userHealthProfile.create({
      data: {
        userId: user.id,
        aiIncludedSections: ["ABOUT_ME", "HABITS", "GOALS"],
        lifeConfirmedJson: { work: "2026-09-01T10:00:00.000Z" },
      },
    });
    const goals = { schema: 1, goals: ["sleep", "fitness"] };
    const tobacco = {
      schema: 1,
      products: ["cigarettes"],
      cigarettesPerDay: 10,
      startYear: 2001,
      quitMonth: null,
      secondhandSmoke: null,
    };
    await prisma.healthProfileFactRevision.createMany({
      data: [
        {
          id: "goals-current",
          userId: user.id,
          kind: "HEALTH_GOALS",
          valueEncrypted: encryptToBytes(JSON.stringify(goals)),
          validFrom: new Date("2026-08-01T00:00:00.000Z"),
        },
        {
          id: "tobacco-current",
          userId: user.id,
          kind: "TOBACCO_DETAIL",
          valueEncrypted: encryptToBytes(JSON.stringify(tobacco)),
          validFrom: new Date("2026-08-01T00:00:00.000Z"),
        },
      ],
    });
    await prisma.mentalHealthAssessment.create({
      data: {
        id: "audit-c-entry",
        userId: user.id,
        instrument: "AUDIT_C",
        locale: "de",
        responsesEncrypted: encryptToBytes(
          JSON.stringify({ schema: 1, items: [2, 1, 1] }),
        ),
        totalScore: 4,
        severityBand: "unbanded",
        takenAt: new Date("2026-09-15T08:00:00.000Z"),
      },
    });

    // Disaster recovery: everything, the AUDIT-C entry included.
    const dr = parseBackupPayload(
      JSON.parse(
        JSON.stringify(
          (
            await buildFullBackupPayload(prisma, user.id, {
              purpose: "disaster-recovery",
            })
          ).payload,
        ),
      ),
    );
    expect(dr.healthProfile?.aiIncludedSections).toEqual([
      "ABOUT_ME",
      "HABITS",
      "GOALS",
    ]);
    expect(dr.healthProfileFacts.map((f) => f.kind).sort()).toEqual([
      "HEALTH_GOALS",
      "TOBACCO_DETAIL",
    ]);
    expect(dr.mentalHealthAssessments.map((a) => a.instrument)).toEqual([
      "AUDIT_C",
    ]);

    await prisma.$transaction(async (tx) => {
      await restoreProfileData(tx, user.id, dr);
      await restoreSensitiveData(tx, user.id, dr);
    });
    const restored = await prisma.userHealthProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(restored.aiIncludedSections).toEqual([
      "ABOUT_ME",
      "HABITS",
      "GOALS",
    ]);
    expect(restored.lifeConfirmedJson).toEqual({
      work: "2026-09-01T10:00:00.000Z",
    });
    const audit = await prisma.mentalHealthAssessment.findUniqueOrThrow({
      where: { id: "audit-c-entry" },
    });
    expect(audit.instrument).toBe("AUDIT_C");
    expect(audit.totalScore).toBe(4);

    // Portable: the values travel readable and come back sealed and valid.
    const portable = parseBackupPayload(
      JSON.parse(
        JSON.stringify((await buildFullBackupPayload(prisma, user.id)).payload),
      ),
    );
    const goalsEntry = portable.healthProfileFacts.find(
      (f) => f.kind === "HEALTH_GOALS",
    );
    expect(JSON.parse(goalsEntry!.value!)).toEqual(goals);
    await prisma.$transaction((tx) =>
      restoreProfileData(tx, user.id, portable),
    );
    const { decryptLifeFactValue } = await import("@/lib/profile/health-facts");
    const row = await prisma.healthProfileFactRevision.findFirstOrThrow({
      where: { userId: user.id, kind: "TOBACCO_DETAIL" },
    });
    expect(
      decryptLifeFactValue("TOBACCO_DETAIL", row.valueEncrypted).value,
    ).toEqual(tobacco);
  });
});
