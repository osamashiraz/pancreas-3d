/**
 * Schematic circulation, lymph and nerve routes for the human pancreas, after
 * src/domain/living-circuits.ts. A route states a textbook relationship between
 * structures of the inventory. It is not vessel geometry, flow or conduction, and
 * every route is an educational simplification. Where the mouse module had one
 * route in and one out, the human pancreas needs its regions, because the head
 * and the body/tail have different supply, drainage and nodes, and that
 * difference is what surgery and staging turn on.
 */
import { REFS } from './human-pancreas-structures';

export type CircuitKind = 'systemic-arterial' | 'hepatic-portal' | 'lymphatic' | 'neural-efferent' | 'neural-afferent';
export type Division = 'sympathetic' | 'parasympathetic' | 'visceral-sensory';

export interface CircuitRoute {
  readonly id: string;
  readonly kind: CircuitKind;
  /** Structure IDs without the `human-<sex>:` prefix, so one table serves both references. */
  readonly from: string;
  readonly to: string;
  readonly via?: readonly string[];
  readonly division?: Division;
  readonly basis: string;
  readonly references: readonly string[];
}

const GRAY = [REFS.GRAY.text];
const LYMPH = [REFS.JPS.text, REFS.GRAY.text];

export const PANCREAS_ROUTES: readonly CircuitRoute[] = Object.freeze([
  // Arterial supply: the head from two sources, the body and tail from one.
  { id: 'head-supply-coeliac', kind: 'systemic-arterial', from: 'coeliac-trunk', to: 'pancreas-head',
    via: ['common-hepatic-artery', 'gastroduodenal-artery', 'superior-pancreaticoduodenal-arteries'], references: GRAY,
    basis: 'The superior pancreaticoduodenal arteries, from the gastroduodenal branch of the common hepatic artery, supply the head.' },
  { id: 'head-supply-sma', kind: 'systemic-arterial', from: 'superior-mesenteric-artery', to: 'pancreas-head',
    via: ['inferior-pancreaticoduodenal-arteries'], references: GRAY,
    basis: 'The inferior pancreaticoduodenal arteries from the superior mesenteric artery join the superior ones in arcades, so the head is supplied from both the coeliac and the superior mesenteric territory.' },
  { id: 'uncinate-supply', kind: 'systemic-arterial', from: 'superior-mesenteric-artery', to: 'pancreas-uncinate',
    via: ['inferior-pancreaticoduodenal-arteries'], references: GRAY,
    basis: 'The uncinate process is supplied mainly by inferior pancreaticoduodenal branches.' },
  { id: 'neck-body-supply', kind: 'systemic-arterial', from: 'splenic-artery', to: 'pancreas-body',
    via: ['dorsal-pancreatic-artery', 'great-pancreatic-artery'], references: GRAY,
    basis: 'The dorsal and great pancreatic arteries from the splenic artery supply the neck and body, linked by the transverse pancreatic artery.' },
  { id: 'tail-supply', kind: 'systemic-arterial', from: 'splenic-artery', to: 'pancreas-tail',
    via: ['caudal-pancreatic-arteries'], references: GRAY,
    basis: 'Caudal pancreatic branches of the distal splenic artery supply the tail.' },

  // Venous drainage, all to the portal system.
  { id: 'head-drainage', kind: 'hepatic-portal', from: 'pancreas-head', to: 'hepatic-portal-vein',
    via: ['inferior-pancreaticoduodenal-vein', 'superior-mesenteric-vein'], references: GRAY,
    basis: 'The inferior pancreaticoduodenal veins drain the lower head to the superior mesenteric vein, which joins the portal vein.' },
  { id: 'head-drainage-superior', kind: 'hepatic-portal', from: 'pancreas-head', to: 'hepatic-portal-vein',
    via: ['superior-pancreaticoduodenal-veins'], references: GRAY,
    basis: 'The superior pancreaticoduodenal veins drain the upper head directly to the portal vein.' },
  { id: 'body-tail-drainage', kind: 'hepatic-portal', from: 'pancreas-body', to: 'hepatic-portal-vein',
    via: ['splenic-vein'], references: GRAY,
    basis: 'Short pancreatic veins drain the body and tail into the splenic vein, which joins the superior mesenteric vein behind the neck to form the portal vein.' },

  // Lymph, by region.
  { id: 'head-lymph', kind: 'lymphatic', from: 'pancreas-head', to: 'nodes-sma', via: ['nodes-pancreaticoduodenal'], references: LYMPH,
    basis: 'The head drains to the pancreaticoduodenal nodes and on to nodes round the superior mesenteric artery.' },
  { id: 'head-lymph-hepatic', kind: 'lymphatic', from: 'pancreas-head', to: 'nodes-hepatic-artery', references: LYMPH,
    basis: 'The upper head also drains to nodes along the common hepatic artery.' },
  { id: 'body-tail-lymph', kind: 'lymphatic', from: 'pancreas-tail', to: 'nodes-splenic', references: LYMPH,
    basis: 'The body and tail drain to nodes along the splenic artery and at the splenic hilum.' },

  // Nerves: three divisions, where the mouse module has the vagus alone.
  { id: 'sympathetic-efferent', kind: 'neural-efferent', division: 'sympathetic', from: 'greater-splanchnic-nerves', to: 'pancreas-body',
    via: ['coeliac-ganglia'], references: GRAY,
    basis: 'Preganglionic fibres in the splanchnic nerves synapse in the coeliac ganglia; postganglionic fibres follow the arteries into the gland. They are mainly vasomotor and inhibit insulin secretion.' },
  { id: 'parasympathetic-efferent', kind: 'neural-efferent', division: 'parasympathetic', from: 'vagal-coeliac-branch', to: 'intrapancreatic-ganglia',
    via: ['coeliac-ganglia'], references: [...GRAY, REFS.WALKER.text],
    basis: 'Vagal fibres pass through the coeliac plexus without synapsing and end on intrapancreatic ganglia, which drive acinar secretion and insulin release.' },
  { id: 'pain-afferent', kind: 'neural-afferent', division: 'visceral-sensory', from: 'pancreas-head', to: 'greater-splanchnic-nerves',
    via: ['coeliac-ganglia'], references: GRAY,
    basis: 'Pain fibres return with the sympathetic supply through the coeliac plexus and splanchnic nerves, which is why pancreatic pain is felt in the epigastrium and back and why a coeliac plexus block can relieve it.' },
]);
