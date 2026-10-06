// classLabels.js: display names of the classes the inference service returns (the API keeps the codes)

const CLASS_LABELS = {
  healthy: 'Healthy',
  fin_rot: 'Fin rot',
  dermatomycosis: 'Dermatomycosis',
  hexamitosis: 'Hexamitosis',
  mycobacteriosis: 'Mycobacteriosis',
  oodiniosis: 'Oodiniosis',
  plistophorosis: 'Plistophorosis',
};

// A code that is not in the table (a class of a newer model) is shown as it is, with the underscores
// replaced by spaces and the first letter capitalised.
export function classLabel(code) {
  const key = String(code ?? '');
  if (CLASS_LABELS[key]) return CLASS_LABELS[key];
  const text = key.replace(/_/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : 'Unknown';
}
