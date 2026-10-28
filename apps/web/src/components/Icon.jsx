const paths = {
  route:'M5 6h14M5 12h14M5 18h14M3 6h.01M3 12h.01M3 18h.01',
  more:'M5 12h.01M12 12h.01M19 12h.01', reset:'M3 10a9 9 0 1 1 1 8M3 4v6h6',
  arrow:'M4 12h15m-6-6 6 6-6 6', chevron:'m9 5 7 7-7 7', back:'m15 5-7 7 7 7',
  check:'m5 12 4 4L19 6', plus:'M12 5v14M5 12h14', close:'m6 6 12 12M6 18 18 6',
  upload:'M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4',
  paperclip:'m9 16 7-7a3 3 0 0 0-4-4l-7 7a5 5 0 0 0 7 7l7-7',
  plane:'m21 3-7 18-3-8-8-3 18-7ZM11 13 21 3',
  shield:'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-4 9 3 3 5-6',
  spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  document:'M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8M8 16h6',
  clock:'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  card:'M3 5h18v14H3V5Zm0 5h18M6 15h4',
  headset:'M4 14v-3a8 8 0 0 1 16 0v3M4 12H2v7h4v-7H4Zm16 0h2v7h-4v-7h2Zm0 7c0 3-4 3-8 3',
  info:'M12 11v6m0-10v1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  search:'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4',
  lock:'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5V10Zm7 4v3',
  mic:'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5Zm-3 6v1a6 6 0 0 0 12 0v-1m-6 7v4m-4 0h8',
  send:'m21 3-6 18-4-8-8-4 18-6ZM11 13 21 3',
  trash:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
  download:'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4',
  book:'M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2Zm0 0v16',
  edit:'M4 20h4L19 9l-4-4L4 16v4Zm9.5-13.5 4 4',
  external:'M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4',
  alert:'M12 9v4.5M12 17v.01M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z',
  chat:'M5 5.5h14v10H10l-4 3.5v-3.5H5v-10Z',
  medical:'M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6V4Z',
  bank:'M3 10h18M5 10v8m4.7-8v8m4.6-8v8M19 10v8M3 20h18M12 3l9 5H3l9-5Z',
};

export default function Icon({ name, size=20, className='', strokeWidth=1.6 }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.spark} /></svg>;
}

export function Mark({ small=false }) {
  return <svg className={`brand-mark ${small ? 'small' : ''}`} viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect width="40" height="40" rx="10" fill="currentColor"/><path d="M11 29V20h9v-9h9m-5 0h5v5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
