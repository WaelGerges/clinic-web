import { useState } from 'react';
import { api } from './api';
import type { Patient, Visit } from './domain';
import { useWorkspace } from './state';
import { useLanguage } from './i18n';
import { useOperation } from './hooks';
import { Button, Field, Modal, OperationNotice } from './ui';
export function PrintVisit({
  patient,
  visit,
  onClose,
}: {
  patient: Patient;
  visit: Visit;
  onClose: () => void;
}) {
  const { membership: m } = useWorkspace(),
    { t } = useLanguage(),
    [type, setType] = useState('prescription'),
    [language, setLanguage] = useState('en'),
    [reason, setReason] = useState(''),
    op = useOperation();
  const print = () =>
    void op.run(async () => {
      const latest = await api.printable(m.clinic_id, patient.id, visit.id);
      if (!latest.completed) throw new Error(t('Only completed visits can be printed.'));
      const labels =
        language === 'ar'
          ? {
              prescription: 'وصفة طبية',
              summary: 'ملخص الزيارة',
              referral: 'خطاب إحالة',
              patient: 'المريض',
              id: 'رقم المريض',
              date: 'تاريخ الزيارة',
              notes: 'ملاحظات سريرية',
              diagnosis: 'التشخيص',
              followup: 'المتابعة',
              reason: 'سبب الإحالة',
              medication: 'الدواء',
              instructions: 'التعليمات',
              revision: 'مراجعة',
            }
          : {
              prescription: 'Prescription',
              summary: 'Visit summary',
              referral: 'Referral letter',
              patient: 'Patient',
              id: 'Patient ID',
              date: 'Visit date',
              notes: 'Clinical notes',
              diagnosis: 'Diagnosis',
              followup: 'Follow-up',
              reason: 'Referral reason',
              medication: 'Medication',
              instructions: 'Instructions',
              revision: 'Revision',
            };
      const frame = document.createElement('iframe');
      frame.className = 'print-frame';
      frame.title = t('Print preview');
      document.body.append(frame);
      const doc = frame.contentDocument!;
      doc.open();
      doc.write(
        '<!doctype html><html><head><title>Clinic document</title></head><body></body></html>',
      );
      doc.close();
      doc.documentElement.lang = language;
      doc.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
      const style = doc.createElement('style');
      style.textContent =
        '@font-face{font-family:Amiri;src:url("/fonts/Amiri-Regular.ttf")}body{font-family:Georgia,Amiri,serif;color:#222;margin:40px;line-height:1.6}h1{font-size:32px;border-bottom:2px solid #222;padding-bottom:14px}h2{font-size:19px;margin-top:25px}p{white-space:pre-wrap}small{color:#555}article{break-inside:avoid;border-bottom:1px solid #ccc;padding:12px 0}@page{margin:18mm}';
      doc.head.append(style);
      const add = (tag: string, text: string) => {
        const el = doc.createElement(tag);
        el.textContent = text;
        doc.body.append(el);
        return el;
      };
      add('small', m.clinics.name);
      add('h1', labels[type as 'prescription' | 'summary' | 'referral']);
      add(
        'p',
        labels.patient +
          ': ' +
          patient.full_name +
          '\n' +
          labels.id +
          ': P-' +
          patient.patient_number +
          '\n' +
          labels.date +
          ': ' +
          new Intl.DateTimeFormat(language, {
            dateStyle: 'long',
            timeZone: m.clinics.time_zone,
          }).format(new Date(latest.created_at)),
      );
      if (type !== 'prescription') {
        add('h2', labels.diagnosis);
        add('p', latest.diagnoses.join('\n'));
        if (type === 'summary') {
          add('h2', labels.notes);
          add('p', latest.notes);
        } else {
          add('h2', labels.reason);
          add('p', reason);
        }
      }
      if (type !== 'referral')
        for (const med of latest.medications) {
          const article = add('article', '');
          const h = doc.createElement('h2');
          h.textContent = med.name + ' ' + med.strength;
          article.append(h);
          const p = doc.createElement('p');
          p.textContent =
            [med.dose, med.frequency, med.duration].filter(Boolean).join(' · ') +
            '\n' +
            med.instructions +
            (med.notes ? '\n' + med.notes : '');
          article.append(p);
        }
      if (type !== 'prescription') {
        add('h2', labels.followup);
        add('p', latest.follow_up);
      }
      add('small', labels.revision + ' ' + latest.current_revision);
      await doc.fonts.ready;
      const cleanup = () => setTimeout(() => frame.remove(), 1000);
      frame.contentWindow!.addEventListener('afterprint', cleanup, { once: true });
      setTimeout(cleanup, 60000);
      frame.contentWindow!.focus();
      frame.contentWindow!.print();
    });
  return (
    <Modal title="Print / export" onClose={onClose} locked={op.busy}>
      <Field label="Document type">
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="prescription">{t('Prescription')}</option>
          <option value="summary">{t('Visit summary')}</option>
          {m.role === 'doctor' && <option value="referral">{t('Referral letter')}</option>}
        </select>
      </Field>
      <Field label="Document language">
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="en">English</option>
          <option value="ar">العربية</option>
        </select>
      </Field>
      {type === 'referral' && (
        <Field label="Referral reason">
          <textarea
            rows={4}
            maxLength={5000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      )}
      <p className="muted">
        {t(
          'The latest saved visit will be used. Choose Save as PDF in the print dialog to export.',
        )}
      </p>
      <Button primary onClick={print} disabled={op.busy || (type === 'referral' && !reason.trim())}>
        {t('Print / save PDF')}
      </Button>
      <OperationNotice op={op} />
    </Modal>
  );
}
