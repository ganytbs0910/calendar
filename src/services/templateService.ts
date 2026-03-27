import AsyncStorage from '@react-native-async-storage/async-storage';

const TEMPLATES_STORAGE_KEY = '@event_templates';

export interface EventTemplate {
  id: string;
  title: string;
  durationMinutes: number;
  color: string;
  reminder: number | null; // minutes before event (negative)
}

export const getTemplates = async (): Promise<EventTemplate[]> => {
  try {
    const json = await AsyncStorage.getItem(TEMPLATES_STORAGE_KEY);
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
};

export const saveTemplates = async (templates: EventTemplate[]): Promise<void> => {
  await AsyncStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
};

export const addTemplate = async (template: Omit<EventTemplate, 'id'>): Promise<EventTemplate> => {
  const templates = await getTemplates();
  const newTemplate: EventTemplate = {
    ...template,
    id: Date.now().toString(),
  };
  templates.push(newTemplate);
  await saveTemplates(templates);
  return newTemplate;
};

export const deleteTemplate = async (id: string): Promise<void> => {
  const templates = await getTemplates();
  await saveTemplates(templates.filter(t => t.id !== id));
};

export const updateTemplate = async (id: string, updates: Partial<Omit<EventTemplate, 'id'>>): Promise<void> => {
  const templates = await getTemplates();
  const index = templates.findIndex(t => t.id === id);
  if (index !== -1) {
    templates[index] = {...templates[index], ...updates};
    await saveTemplates(templates);
  }
};
