import type { DateRepairPlan } from '../../locked-date-repair';
import type { RepairTimestamp } from '../../utils/repairDateFromFilename';

function displayDate(value: RepairTimestamp): string {
  const wall = new Date((value.timestampSec + value.timezoneSec) * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const minutes = Math.abs(value.timezoneSec / 60);
  return `${wall} UTC${value.timezoneSec < 0 ? '-' : '+'}${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function downloadRepairRecord(filename: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function previewLockedDates(account: string, plans: DateRepairPlan[]): Promise<DateRepairPlan[]> {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'color:#eee;background:#202124;border:1px solid #666;border-radius:12px;padding:24px;max-width:90vw;max-height:85vh;';
    const heading = document.createElement('h2');
    heading.textContent = 'Preview Locked Folder date repairs';
    const note = document.createElement('p');
    note.textContent = `Account: ${account}. All previewed photos are back in Locked Folder. Date-only names preserve the existing time of day; each photo keeps its saved timezone offset. Save the change log before applying.`;
    const scroller = document.createElement('div');
    scroller.style.cssText = 'max-height:50vh;overflow:auto;';
    const table = document.createElement('table');
    const header = table.createTHead().insertRow();
    for (const title of ['Apply', 'Filename', 'Current date', 'Proposed date']) {
      const th = document.createElement('th');
      th.textContent = title;
      th.style.padding = '8px';
      header.appendChild(th);
    }
    const checks: HTMLInputElement[] = [];
    const body = table.createTBody();
    for (const plan of plans) {
      const row = body.insertRow();
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.setAttribute('aria-label', `Apply date change for ${plan.filename}`);
      row.insertCell().appendChild(checkbox);
      checks.push(checkbox);
      for (const value of [plan.filename, displayDate(plan.before), displayDate(plan.after)]) {
        const cell = row.insertCell();
        cell.textContent = value;
        cell.style.padding = '8px';
      }
    }
    scroller.appendChild(table);
    const save = document.createElement('button');
    save.textContent = 'Save change log';
    const apply = document.createElement('button');
    apply.textContent = 'Apply selected changes';
    apply.disabled = true;
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    for (const button of [save, apply, cancel]) button.style.cssText = 'padding:10px;margin:12px 8px 0 0;';
    save.onclick = () => {
      downloadRepairRecord('locked-date-changes.json', {version: 1, account, createdAt: new Date().toISOString(), plans});
      apply.disabled = false;
    };
    const finish = (selected: DateRepairPlan[]) => {
      dialog.close();
      dialog.remove();
      resolve(selected);
    };
    apply.onclick = () => finish(plans.filter((_, i) => checks[i].checked));
    cancel.onclick = () => finish([]);
    dialog.oncancel = event => { event.preventDefault(); finish([]); };
    dialog.append(heading, note, scroller, save, apply, cancel);
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}
