import { scenario } from './scenario.js';
import { ARCHITECTURE } from '../model.js';

const { plan, initial, demand, trimmed, afterRelease, trimPerChat, incomingCapacity } = scenario;
const byId = id => document.getElementById(id);
const count = n => n.toLocaleString('en-US');
const gib = n => n.toFixed(2) + ' GiB';
const cost = gib(demand.allocation.overflow);
const messages = {
  arrival: ['Who gets the memory?', 'Chat C needs ' + count(plan.c) + ' tokens. Only ' + count(incomingCapacity) + ' fit beside the two open chats.'],
  queue: ['Both histories stay intact.', 'Chat C is waiting. Finish Chat A to see when the new conversation can start.'],
  trim: ['All three can work now.', 'A and B each lose their oldest ' + count(trimPerChat) + ' tokens. Their opening instructions are outside the active context.'],
  released: ['Chat C gets the released memory.', 'A has finished. B keeps its full history, and C starts with all ' + count(plan.c) + ' tokens.']
};

const scenes = { arrival: initial, queue: initial, trim: trimmed, released: afterRelease };
const rows = [...document.querySelectorAll('.chat')];
function show(state) {
  const { requests, allocation } = scenes[state];
  const waiting = state === 'queue' || state === 'arrival';
  const shortened = state === 'trim';
  byId('outcome').textContent = messages[state][0];
  byId('consequence').textContent = messages[state][1];
  byId('capacity').textContent = allocation.total.toFixed(2) + ' / ' + allocation.capacity + ' GiB';
  for (const key of ['weights','reserve','cache']) {
    document.querySelector('.gauge .' + key).style.width = (allocation[key] / allocation.capacity * 100) + '%';
  }
  for (const [i, row] of rows.entries()) {
    const req = requests[i];
    const incoming = req.id === 'c';
    const finished = state === 'released' && req.id === 'a';
    const lost = !incoming && shortened ? trimPerChat : 0;
    row.dataset.status = incoming && waiting ? 'waiting' : lost ? 'trimmed' : finished ? 'finished' : 'active';
    row.querySelector('.quantity').textContent = finished ? 'Finished · 0 tokens' : incoming && waiting ? count(plan.c) + ' requested' : count(req.retained) + ' tokens';
    row.querySelector('.kept').style.width = ((incoming && waiting ? plan.c : req.retained) / plan.a * 100) + '%';
    if (!incoming) {
      row.querySelector('.lost').style.width = (lost / plan.a * 100) + '%';
      row.querySelector('.excerpt-label').textContent = lost ? 'Dropped from context' : finished ? 'Session closed' : 'Oldest message';
    }
  }
  byId('incoming-state').textContent = state === 'arrival' ? 'Requesting admission' : state === 'queue' ? 'Waiting for a chat to finish' : 'Admitted with full context';
  byId('wait').setAttribute('aria-pressed', String(state === 'queue' || state === 'released'));
  byId('trim').setAttribute('aria-pressed', String(shortened));
  byId('finish').hidden = state !== 'queue';
  byId('reset').hidden = state === 'arrival';
}
byId('wait').onclick = () => show('queue');
byId('trim').onclick = () => show('trim');
byId('finish').onclick = () => { show('released'); byId('wait').focus(); };
byId('reset').onclick = () => { show('arrival'); byId('wait').focus(); };
byId('basis').textContent = 'Estimated budget: ' + plan.capacity + ' GiB. One shared 8B model at ' + plan.bits + ' bits uses ' + gib(initial.allocation.weights) +
  ', with an assumed reserve of ' + gib(plan.reserve) + '. The original three full contexts would exceed the budget by ' + cost +
  '. Cache geometry: ' + ARCHITECTURE.layers + ' layers, ' + ARCHITECTURE.kvHeads + ' KV heads, ' + ARCHITECTURE.headDimension + ' dimensions per head, ' + ARCHITECTURE.cacheBits + '-bit cache.';
show('arrival');
document.querySelector('.instrument').hidden = false;
document.querySelector('.controls').hidden = false;
