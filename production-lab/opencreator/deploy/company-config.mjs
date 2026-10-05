export function managedTextDefault(document,catalog,initialized) {
  const saved=document.creatorServices?.llm?.model;
  return initialized&&catalog.models.some(model=>model.id===saved)?saved:'claude-sonnet-5-5-t3a';
}
