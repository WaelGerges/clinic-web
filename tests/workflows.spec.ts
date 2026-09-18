import { test, expect } from '@playwright/test';
import { clinicFixture, enterClinic } from './fixture';
test('assistant ledger matches the chosen design and supports queue handoff', async ({ page }) => {
  const state = await clinicFixture(page);
  await enterClinic(page);
  await expect(page.getByRole('heading', { name: 'Clinic Assistant' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Today', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page
    .getByRole('row')
    .filter({ hasText: 'Nour Hassan' })
    .getByRole('button', { name: 'View', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Waiting', { exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Send to doctor', exact: true })
    .click();
  await expect(page.getByRole('dialog').getByText('With doctor', { exact: true })).toBeVisible();
  expect(state.commands.map((x) => x.p_action)).toEqual(['status', 'send']);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-artifacts/assistant-desktop.png', fullPage: true });
});
test('doctor acknowledges, saves a prescription, and completes a visit', async ({ page }) => {
  const state = await clinicFixture(page, 'doctor');
  await enterClinic(page);
  await expect(page.getByRole('textbox', { name: 'Clinical notes', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Acknowledge receipt', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Clinical notes', exact: true })
    .fill('Patient reports improved symptoms. Examination documented.');
  await page.getByRole('textbox', { name: 'Diagnosis', exact: true }).fill('Follow-up assessment');
  await page.getByRole('button', { name: 'Add medication', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Medication name', exact: true })
    .fill('Fictional test medication');
  await page.getByRole('textbox', { name: 'Dose', exact: true }).fill('Test dose');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Saved to the clinic', { exact: false })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-artifacts/doctor-desktop.png', fullPage: true });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Complete visit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ready for the next patient.' })).toBeVisible();
  expect(state.commands.at(-1)?.p_action).toBe('complete');
  expect(state.visits[0].completed).toBe(true);
});
test('patient registration normalizes Arabic digits and sends no new assistant alerts', async ({
  page,
}) => {
  const state = await clinicFixture(page);
  await enterClinic(page);
  await page.getByRole('button', { name: 'Patients', exact: true }).click();
  await page.getByRole('button', { name: 'Register patient', exact: true }).click();
  await page.getByRole('textbox', { name: 'Full name', exact: true }).fill('Fictional New Patient');
  await page.getByLabel('Birth date', { exact: true }).fill('1990-01-01');
  await page.getByRole('textbox', { name: 'Mobile', exact: true }).fill('٠١٠ ١٢٣٤٥٦٧٨');
  await page.getByRole('button', { name: 'Save patient', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Fictional New Patient', exact: true }),
  ).toBeVisible();
  const payload = state.commands[0].p_payload as Record<string, unknown>;
  expect(payload.mobile).toBe('01012345678');
  expect(payload.alerts).toBe('');
});
test('uncertain saves retry exactly the same operation without duplicating patients', async ({
  page,
}) => {
  const state = await clinicFixture(page, 'assistant', { uncertain: true });
  await enterClinic(page);
  await page.getByRole('button', { name: 'Patients', exact: true }).click();
  await page.getByRole('button', { name: 'Register patient', exact: true }).click();
  await page.getByRole('textbox', { name: 'Full name', exact: true }).fill('Retry Patient');
  await page.getByLabel('Birth date', { exact: true }).fill('1990-01-01');
  await page.getByRole('textbox', { name: 'Mobile', exact: true }).fill('01012345678');
  await page.getByRole('button', { name: 'Save patient', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('server response could not be confirmed');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Retry Patient', exact: true })).toBeVisible();
  expect(state.commands[0]).toEqual(state.commands[1]);
  expect(state.patients.filter((p) => p.full_name === 'Retry Patient')).toHaveLength(1);
});
test('conflicts retain edited content without overwriting the server', async ({ page }) => {
  await clinicFixture(page, 'doctor', { conflict: true });
  await enterClinic(page);
  await page.getByRole('button', { name: 'Acknowledge receipt', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Clinical notes', exact: true })
    .fill('Keep this unsaved note');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('changed on another device');
  await expect(page.getByRole('textbox', { name: 'Clinical notes', exact: true })).toHaveValue(
    'Keep this unsaved note',
  );
});
test('Arabic mobile layout remains within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('clinic-language', 'ar'));
  await clinicFixture(page);
  await enterClinic(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'مساعد العيادة' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-artifacts/assistant-arabic-mobile.png', fullPage: true });
});
test('offline connectivity disables mutations', async ({ page, context }) => {
  await clinicFixture(page);
  await enterClinic(page);
  await context.setOffline(true);
  await expect(
    page.getByText('Connection required. Changes are disabled until the clinic reconnects.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Book appointment', exact: true })).toBeDisabled();
});
test('assistant cannot see clinical history or administrative staff controls', async ({ page }) => {
  await clinicFixture(page);
  await enterClinic(page);
  await page.getByRole('button', { name: 'Patients', exact: true }).click();
  await page.getByRole('button', { name: 'Nour Hassan', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'History', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Staff access', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Audit history', exact: true })).toHaveCount(0);
});

test('booking submits Cairo time and the existing scheduling contract', async ({ page }) => {
  const state = await clinicFixture(page);
  await enterClinic(page);
  await page.getByRole('tab', { name: 'Tomorrow', exact: true }).click();
  await page.getByRole('button', { name: 'Book appointment', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Nour Hassan/ }).click();
  await dialog.getByLabel('Time', { exact: true }).fill('15:00');
  await dialog.getByLabel('Duration (minutes)', { exact: true }).fill('45');
  await dialog.getByRole('button', { name: 'Book appointment', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const cmd = state.commands[0],
    payload = cmd.p_payload as Record<string, unknown>;
  expect(cmd.p_entity_type).toBe('appointment');
  expect(payload.duration_minutes).toBe(45);
  expect(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(String(payload.starts_at))),
  ).toBe('15:00');
});
test('documents preserve metadata, verify bytes, and archive without deleting', async ({
  page,
}) => {
  const state = await clinicFixture(page, 'doctor');
  await enterClinic(page);
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await page.getByRole('button', { name: 'Nour Hassan', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Documents', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: 'Upload document', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('File', { exact: true }).setInputFiles({
    name: 'fictional-lab.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nFictional browser integrity test'),
  });
  await dialog.getByRole('button', { name: 'Upload document', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'fictional-lab.pdf' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('fictional-lab.pdf');
  expect(String(state.documents[0].sha256_hex)).toMatch(/^[a-f0-9]{64}$/);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'fictional-lab.pdf' })).toHaveCount(0);
  await page.getByLabel('Show archived documents', { exact: true }).check();
  await expect(page.getByRole('heading', { name: 'fictional-lab.pdf' })).toBeVisible();
  expect(state.documents[0].state).toBe('archived');
});
test('working hours and staff controls use their existing RPCs', async ({ page }) => {
  const state = await clinicFixture(page, 'doctor');
  await enterClinic(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Working hours', exact: true }).click();
  await page.getByRole('button', { name: 'Add period', exact: true }).click();
  await page.getByRole('button', { name: 'Save working hours', exact: true }).click();
  await expect(page.getByLabel('From', { exact: true })).toHaveValue('09:00');
  await page.getByRole('tab', { name: 'Staff access', exact: true }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Deactivate', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Reactivate', exact: true })).toBeVisible();
  expect(state.staff.find((s) => s.role === 'assistant')?.active).toBe(false);
  await page.getByRole('tab', { name: 'Audit history', exact: true }).click();
  await expect(page.getByText('visit.save', { exact: true })).toBeVisible();
});
test('membership revocation closes the clinical workspace', async ({ page }) => {
  await page.clock.install();
  const state = await clinicFixture(page, 'doctor');
  await enterClinic(page);
  await expect(page.getByRole('heading', { name: 'Nour Hassan' })).toBeVisible();
  state.revoke();
  await page.clock.fastForward(21000);
  await expect(page.getByRole('heading', { name: 'Nour Hassan' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Your clinic permissions changed');
});
test('the English doctor layout works on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await clinicFixture(page, 'doctor');
  await enterClinic(page);
  await page.getByRole('button', { name: 'Acknowledge receipt', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Clinical notes', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-artifacts/doctor-mobile.png', fullPage: true });
});

test('a changed assignment retains an unsaved consultation instead of losing it', async ({
  page,
}) => {
  await page.clock.install();
  const state = await clinicFixture(page, 'doctor');
  await enterClinic(page);
  await page.getByRole('button', { name: 'Acknowledge receipt', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Clinical notes', exact: true })
    .fill('Retain this note after reassignment');
  state.appointments[0].status = 'waiting';
  await page.clock.fastForward(21000);
  await expect(page.getByRole('alert')).toContainText('Your unsaved notes are retained');
  await expect(page.getByRole('textbox', { name: 'Clinical notes', exact: true })).toHaveValue(
    'Retain this note after reassignment',
  );
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Discard draft and refresh', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ready for the next patient.' })).toBeVisible();
});
