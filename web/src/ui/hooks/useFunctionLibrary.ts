import { useEffect, useMemo, useState } from 'react';

export type FunctionEntry = {
  id: string;
  title: string;
  subject: string;
  tags: string[];
  description: string;
  snippet: string;
  signature?: string;
};

export function useFunctionLibrary() {
  const [all, setAll] = useState<FunctionEntry[]>([]);
  const [search, setSearch] = useState('');
  const [subject, setSubject] = useState('all');

  useEffect(() => {
    fetch('/functions.json')
      .then((res) => res.json())
      .then((data) => setAll(data))
      .catch(() => setAll([]));
  }, []);

  const subjects = useMemo(() => {
    return Array.from(new Set(all.map((f) => f.subject))).sort();
  }, [all]);

  const functions = useMemo(() => {
    const q = search.toLowerCase();
    return all.filter((fn) => {
      if (subject !== 'all' && fn.subject !== subject) return false;
      if (!q) return true;
      return (
        fn.title.toLowerCase().includes(q) ||
        fn.description.toLowerCase().includes(q) ||
        fn.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [all, search, subject]);

  return { functions, allFunctions: all, subjects, search, setSearch, subject, setSubject };
}
