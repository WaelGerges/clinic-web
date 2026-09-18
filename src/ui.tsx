import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ReactElement,
  type ReactNode,
  type ButtonHTMLAttributes,
} from 'react';
import { useLanguage } from './i18n';
import { statusLabels, type Status } from './domain';
import type { useOperation } from './hooks';
export function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    schedule: (
      <>
        <rect x="4" y="5" width="16" height="16" rx="1" />
        <path d="M4 10h16M8 3v4m8-4v4M8 14h2m4 0h2m-8 3h2" />
      </>
    ),
    patients: (
      <>
        <circle cx="12" cy="7" r="4" />
        <path d="M4 21v-3a8 8 0 0 1 16 0v3M4 21h16" />
      </>
    ),
    queue: (
      <>
        <circle cx="5" cy="6" r="1" />
        <circle cx="5" cy="12" r="1" />
        <circle cx="5" cy="18" r="1" />
        <path d="M10 6h10M10 12h10M10 18h10" />
      </>
    ),
    documents: (
      <>
        <path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="m12 2 2 3 3-1 1 4 3 2-2 3 1 4-4 1-2 3-3-2-4 1-1-4-3-2 2-3-1-4 4-1z" />
      </>
    ),
    consult: (
      <>
        <path d="M6 3v7a6 6 0 0 0 12 0V3M4 3h4m8 0h4M12 16v2a4 4 0 0 0 8 0v-4" />
        <circle cx="20" cy="12" r="2" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    logout: (
      <>
        <path d="M10 4H4v16h6M10 12h11m-5-5 5 5-5 5" />
      </>
    ),
    refresh: <path d="M20 8a8 8 0 1 0 0 8M20 3v6h-6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    check: <path d="m4 12 5 5L20 6" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.documents}
    </svg>
  );
}
export function Button({
  children,
  primary = false,
  icon,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; icon?: string }) {
  return (
    <button type="button" className={primary ? 'button primary' : 'button'} {...props}>
      {icon && <Icon name={icon} />}
      <span>{children}</span>
    </button>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const { t } = useLanguage(),
    id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{t(label)}</label>
      {Children.map(children, (child) =>
        isValidElement(child) && ['input', 'select', 'textarea'].includes(String(child.type))
          ? cloneElement(child as ReactElement<{ id?: string; 'aria-describedby'?: string }>, {
              id,
              'aria-describedby': hint ? id + '-hint' : undefined,
            })
          : child,
      )}
      {hint && <small id={id + '-hint'}>{t(hint)}</small>}
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  const { t } = useLanguage();
  return (
    <div className="empty">
      <span className="empty-rule" />
      <h3>{t(title)}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export function ErrorMessage({ message, retry }: { message: string; retry?: () => void }) {
  const { t } = useLanguage();
  return (
    <div role="alert" className="notice error">
      <span>{t(message)}</span>
      {retry && <Button onClick={retry}>{t('Try again')}</Button>}
    </div>
  );
}
export function OperationNotice({ op }: { op: ReturnType<typeof useOperation> }) {
  const { t } = useLanguage();
  return (
    <>
      {op.busy && (
        <div role="status" className="notice">
          {t('Confirming with the clinic…')}
        </div>
      )}
      {op.error && (
        <ErrorMessage
          message={op.error.message}
          retry={op.uncertain ? () => void op.run() : undefined}
        />
      )}
    </>
  );
}
export function StatusBadge({ status }: { status: Status }) {
  const { t } = useLanguage();
  return (
    <span className={'status ' + status}>
      <i />
      {t(statusLabels[status])}
    </span>
  );
}
export function Tabs({
  items,
  value,
  onChange,
  label = 'Sections',
}: {
  items: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  const { t, locale } = useLanguage(),
    ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className="folder-tabs"
      role="tablist"
      aria-label={t(label)}
      onKeyDown={(e) => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const i = items.findIndex((x) => x.id === value);
        const next =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? items.length - 1
              : (i +
                  (e.key === 'ArrowRight' ? (locale === 'ar' ? -1 : 1) : locale === 'ar' ? 1 : -1) +
                  items.length) %
                items.length;
        onChange(items[next].id);
        (ref.current?.children[next] as HTMLElement)?.focus();
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={value === item.id}
          tabIndex={value === item.id ? 0 : -1}
          onClick={() => onChange(item.id)}
        >
          {t(item.label)}
        </button>
      ))}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  locked = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  locked?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId(),
    { t } = useLanguage();
  useEffect(() => {
    const dialog = ref.current,
      previous = document.activeElement as HTMLElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? 'modal wide' : 'modal'}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) onClose();
      }}
    >
      <header>
        <div>
          <span className="eyebrow">{t('Clinic records')}</span>
          <h2 id={id}>{t(title)}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={t('Close')}
          disabled={locked}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Pager({
  page,
  count,
  onChange,
}: {
  page: number;
  count: number;
  onChange: (page: number) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="pager">
      <Button disabled={page === 0} onClick={() => onChange(page - 1)}>
        {t('Previous')}
      </Button>
      <span>
        {t('Page')} {page + 1}
      </span>
      <Button disabled={count < 50} onClick={() => onChange(page + 1)}>
        {t('Next')}
      </Button>
    </div>
  );
}
