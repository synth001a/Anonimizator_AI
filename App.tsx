import React, { useState, useEffect, useRef } from 'react';
import { 
  FileUp, 
  ShieldCheck, 
  Settings, 
  Download, 
  Loader2, 
  AlertCircle,
  Eye,
  EyeOff,
  Trash2,
  Info,
  AlertTriangle,
  Key,
  Lock,
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import { PiiCategory, RedactionMark, PDFPageData, RedactionSettings } from './types';
import { detectPiiInImage } from './geminiService';

// @ts-ignore
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

export default function App() {
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PDFPageData[]>([]);
  const [redactions, setRedactions] = useState<RedactionMark[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<RedactionSettings>({
    categories: [PiiCategory.NAME, PiiCategory.SURNAME, PiiCategory.PESEL, PiiCategory.EMAIL],
    customKeywords: []
  });
  const [newKeyword, setNewKeyword] = useState('');
  const [showSensitive, setShowSensitive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sprawdzanie dostępności klucza przy starcie
  useEffect(() => {
    const checkStatus = async () => {
      // Jeśli klucz jest już wstrzyknięty do środowiska, wchodzimy od razu
      const envKey = process.env.API_KEY;
      if (envKey && envKey !== 'UNDEFINED' && envKey !== '') {
        setHasApiKey(true);
        return;
      }

      // @ts-ignore
      if (window.aistudio?.hasSelectedApiKey) {
        try {
          // @ts-ignore
          const selected = await window.aistudio.hasSelectedApiKey();
          if (selected) setHasApiKey(true);
        } catch (e) {
          console.log("Czekam na interakcję użytkownika z kluczem...");
        }
      }
    };
    checkStatus();
  }, []);

  const handleOpenKeySelector = async () => {
    setError(null);
    try {
      // @ts-ignore
      if (window.aistudio?.openSelectKey) {
        // @ts-ignore
        await window.aistudio.openSelectKey();
      }
      // Niezależnie od tego, czy okno się otworzyło, pozwalamy przejść do aplikacji.
      // Ewentualny błąd braku klucza obsłuży geminiService podczas próby analizy.
      setHasApiKey(true);
    } catch (e: any) {
      // Fallback: jeśli coś poszło nie tak z oknem, i tak wpuszczamy użytkownika
      setHasApiKey(true);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setError(null);
      setFile(selectedFile);
      setPages([]);
      setRedactions([]);
      await loadPdf(selectedFile);
    }
  };

  const loadPdf = async (file: File) => {
    setIsProcessing(true);
    setProcessingStatus('Wczytywanie dokumentu...');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const loadedPages: PDFPageData[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        setProcessingStatus(`Konwersja strony ${i}/${pdf.numPages}...`);
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport }).promise;
        loadedPages.push({
          pageNumber: i,
          imageUrl: canvas.toDataURL('image/jpeg', 0.8),
          width: viewport.width,
          height: viewport.height
        });
      }
      setPages(loadedPages);
    } catch (err: any) {
      setError("Błąd PDF: " + err.message);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const startAnonymization = async () => {
    if (pages.length === 0) return;
    setIsProcessing(true);
    setError(null);
    const newRedactions: RedactionMark[] = [];

    try {
      for (const page of pages) {
        setProcessingStatus(`Skanowanie strony ${page.pageNumber}...`);
        const base64 = page.imageUrl.split(',')[1];
        const results = await detectPiiInImage(base64, settings.categories, settings.customKeywords);

        results.forEach((res, idx) => {
          newRedactions.push({
            id: `r-${page.pageNumber}-${idx}-${Date.now()}`,
            category: res.category,
            // Naprawa React #31: rzutujemy wynik na String, by uniknąć renderowania obiektów
            text: String(res.text || ''),
            pageNumber: page.pageNumber,
            confidence: 1,
            box: { 
              ymin: res.box_2d[0], 
              xmin: res.box_2d[1], 
              ymax: res.box_2d[2], 
              xmax: res.box_2d[3] 
            }
          });
        });
      }
      setRedactions(newRedactions);
      setProcessingStatus('Zakończono analizę.');
      setTimeout(() => setProcessingStatus(''), 3000);
    } catch (err: any) {
      setError(err.message);
      // Jeśli błąd dotyczy klucza, pozwalamy użytkownikowi wybrać go ponownie
      if (err.message.includes("API key") || err.message.includes("autoryzacji")) {
        setHasApiKey(false);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadRedactedPdf = async () => {
    if (pages.length === 0) return;
    setIsProcessing(true);
    setProcessingStatus('Przygotowywanie pliku...');
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({
        orientation: pages[0].width > pages[0].height ? 'l' : 'p',
        unit: 'px',
        format: [pages[0].width, pages[0].height]
      });

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (i > 0) doc.addPage([page.width, page.height], page.width > page.height ? 'l' : 'p');
        doc.addImage(page.imageUrl, 'JPEG', 0, 0, page.width, page.height);
        
        const pageRedactions = redactions.filter(r => r.pageNumber === page.pageNumber);
        doc.setFillColor(0, 0, 0);
        pageRedactions.forEach(red => {
          const x = (red.box.xmin / 1000) * page.width;
          const y = (red.box.ymin / 1000) * page.height;
          const w = ((red.box.xmax - red.box.xmin) / 1000) * page.width;
          const h = ((red.box.ymax - red.box.ymin) / 1000) * page.height;
          doc.rect(x, y, w, h, 'F');
        });
      }
      doc.save(`zanonimizowany_${file?.name || 'dokument'}.pdf`);
    } catch (err: any) {
      setError("Błąd eksportu: " + err.message);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  if (!hasApiKey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full bg-white rounded-[2.5rem] shadow-2xl p-10 text-center border border-slate-100 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-600 to-purple-600"></div>
          <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-inner">
            <Lock size={40} />
          </div>
          <h2 className="text-3xl font-black text-slate-800 mb-4 tracking-tight">Witaj w Anonimizator.AI</h2>
          <p className="text-slate-500 mb-8 leading-relaxed text-sm">
            Narzędzie wykorzystuje sztuczną inteligencję do ochrony Twoich danych. 
            Aby zacząć, podłącz klucz Gemini API.
          </p>
          
          <button 
            onClick={handleOpenKeySelector}
            className="group w-full py-5 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 flex items-center justify-center gap-3 active:scale-95 mb-6"
          >
            <Key size={20} />
            Podłącz klucz i zacznij
            <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
          </button>

          <div className="flex flex-col gap-2">
            <a 
              href="https://aistudio.google.com/app/apikey" 
              target="_blank" 
              className="text-[10px] text-slate-400 hover:text-indigo-600 flex items-center justify-center gap-1 font-bold transition-colors uppercase tracking-wider"
            >
              Pobierz darmowy klucz Gemini <ExternalLink size={10} />
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans text-slate-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 px-8 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <div className="bg-indigo-600 p-2.5 rounded-xl shadow-lg shadow-indigo-200">
            <ShieldCheck className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-slate-800">Anonimizator.AI</h1>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">System aktywny</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            disabled={isProcessing}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-all font-bold text-sm border border-slate-200/50"
          >
            <FileUp size={18} />
            {file ? 'Zmień dokument' : 'Wczytaj PDF'}
          </button>
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".pdf" />

          {redactions.length > 0 && (
            <button 
              disabled={isProcessing}
              onClick={downloadRedactedPdf}
              className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all font-black text-sm shadow-xl shadow-indigo-100"
            >
              <Download size={18} />
              Pobierz Wynik
            </button>
          )}

          <button 
            onClick={() => setHasApiKey(false)}
            className="p-2.5 text-slate-400 hover:text-slate-600 transition-colors bg-slate-50 rounded-xl border border-slate-200/50"
            title="Ustawienia klucza"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <aside className="w-84 border-r border-slate-200 bg-white overflow-y-auto p-8 space-y-8 flex flex-col">
          {error && (
            <div className="bg-red-50 border border-red-200 p-5 rounded-2xl flex gap-4 text-red-700 text-xs animate-in slide-in-from-top-2 duration-300">
              <AlertTriangle className="shrink-0 text-red-500" size={20} />
              <div className="space-y-1">
                <p className="font-black uppercase tracking-wider text-[10px]">Wykryto problem</p>
                <p className="font-medium leading-relaxed">{error}</p>
              </div>
            </div>
          )}

          <div className="flex-1 space-y-8">
            <section>
              <div className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-5 flex items-center gap-2">
                <ShieldCheck size={14} className="text-indigo-500" /> Co ukrywamy?
              </div>
              <div className="grid grid-cols-1 gap-2">
                {Object.values(PiiCategory).map(cat => (
                  <label key={cat} className="flex items-center justify-between p-3.5 rounded-xl hover:bg-indigo-50/50 cursor-pointer transition-all border border-transparent hover:border-indigo-100 group">
                    <span className="text-[13px] font-bold text-slate-600 group-hover:text-indigo-700 transition-colors">{cat}</span>
                    <input 
                      type="checkbox" 
                      className="w-5 h-5 text-indigo-600 rounded-lg border-slate-300 focus:ring-indigo-500 transition-all"
                      checked={settings.categories.includes(cat)}
                      onChange={() => setSettings(s => ({...s, categories: s.categories.includes(cat) ? s.categories.filter(c => c !== cat) : [...s.categories, cat]}))}
                    />
                  </label>
                ))}
              </div>
            </section>

            <section>
              <div className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Własne frazy</div>
              <div className="relative">
                <input 
                  type="text" value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)}
                  placeholder="Np. nazwa firmy..."
                  className="w-full text-sm border border-slate-200 rounded-xl px-4 py-3.5 outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-slate-50"
                  onKeyDown={(e) => e.key === 'Enter' && newKeyword && (setSettings(s => ({...s, customKeywords: [...s.customKeywords, newKeyword]})), setNewKeyword(''))}
                />
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                {settings.customKeywords.map(k => (
                  <span key={k} className="bg-white text-slate-600 px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-2 border border-slate-200 shadow-sm">
                    {k}
                    <button onClick={() => setSettings(s => ({...s, customKeywords: s.customKeywords.filter(x => x !== k)}))} className="text-slate-400 hover:text-red-500 transition-colors">
                      <Trash2 size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </section>

            {redactions.length > 0 && (
              <section className="pt-8 border-t border-slate-100">
                <div className="flex items-center justify-between mb-5">
                  <span className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Znalezione dane</span>
                  <button onClick={() => setShowSensitive(!showSensitive)} className="text-indigo-600 p-2 bg-indigo-50 rounded-xl hover:bg-indigo-100 transition-all">
                    {showSensitive ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-2 scrollbar-thin">
                  {redactions.map(r => (
                    <div key={r.id} className="text-[11px] p-3.5 bg-slate-50 rounded-xl border border-slate-100 flex justify-between items-center group hover:bg-white hover:shadow-md hover:border-indigo-100 transition-all">
                      <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-black text-indigo-500 uppercase tracking-widest">{r.category}</span>
                        <span className={showSensitive ? 'text-slate-800 font-black' : 'bg-slate-200 text-transparent rounded px-1 select-none'}>
                          {String(r.text)}
                        </span>
                      </div>
                      <button onClick={() => setRedactions(prev => prev.filter(red => red.id !== r.id))} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="pt-8 mt-auto">
            <button 
              disabled={!file || isProcessing}
              onClick={startAnonymization}
              className="w-full bg-slate-900 text-white py-4.5 rounded-[1.25rem] font-black text-base hover:bg-slate-800 transition-all shadow-2xl disabled:bg-slate-100 disabled:text-slate-300 flex items-center justify-center gap-4 active:scale-95"
            >
              {isProcessing ? <Loader2 className="animate-spin" size={22} /> : <ShieldCheck size={22} />}
              {isProcessing ? 'Przetwarzanie...' : 'Anonimizuj teraz'}
            </button>
            {processingStatus && (
              <div className="mt-5 flex flex-col items-center gap-3">
                <p className="text-[11px] text-indigo-600 font-black uppercase tracking-widest animate-pulse">{processingStatus}</p>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-indigo-600 h-full w-full animate-progress-indefinite"></div>
                </div>
              </div>
            )}
          </div>
        </aside>

        <section className="flex-1 bg-slate-100 overflow-y-auto p-12 flex flex-col items-center">
          {!file ? (
            <div className="text-center mt-32 max-w-sm">
              <div className="w-24 h-24 bg-white rounded-[2.5rem] shadow-xl flex items-center justify-center mx-auto mb-10 text-slate-200 border border-slate-50 group hover:scale-110 transition-transform duration-500">
                <FileUp size={48} className="group-hover:text-indigo-400 transition-colors" />
              </div>
              <h2 className="text-3xl font-black text-slate-800 tracking-tight mb-4">Gotowy do ochrony?</h2>
              <p className="text-slate-500 font-medium leading-relaxed">Wgraj plik PDF, aby automatycznie ukryć dane wrażliwe za pomocą AI.</p>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="mt-10 px-10 py-4 bg-white text-slate-900 rounded-[1.25rem] font-black shadow-lg hover:shadow-2xl transition-all border border-slate-100 active:scale-95"
              >
                Wybierz dokument
              </button>
            </div>
          ) : (
            <div className="space-y-16 max-w-4xl w-full pb-48 animate-in fade-in slide-in-from-bottom-8 duration-1000">
              {pages.map(page => (
                <div 
                  key={page.pageNumber} 
                  className="relative bg-white shadow-[0_32px_64px_-16px_rgba(0,0,0,0.15)] rounded-[2rem] overflow-hidden mx-auto border border-slate-200 group" 
                  style={{ width: page.width, height: page.height }}
                >
                  <img src={page.imageUrl} className="absolute inset-0 w-full h-full object-contain" alt={`Strona ${page.pageNumber}`} />
                  
                  {redactions.filter(r => r.pageNumber === page.pageNumber).map(red => (
                    <div 
                      key={red.id} 
                      className="absolute bg-black group/box cursor-pointer hover:ring-2 hover:ring-indigo-400 transition-all z-10 rounded-[2px]"
                      onClick={() => setRedactions(p => p.filter(r => r.id !== red.id))}
                      style={{ 
                        top: `${red.box.ymin / 10}%`, 
                        left: `${red.box.xmin / 10}%`, 
                        height: `${(red.box.ymax - red.box.ymin) / 10}%`, 
                        width: `${(red.box.xmax - red.box.xmin) / 10}%` 
                      }}
                    >
                      <div className="absolute inset-0 opacity-0 group-hover/box:opacity-100 bg-red-500/20 flex items-center justify-center backdrop-blur-[1px]">
                        <Trash2 className="text-white drop-shadow-md" size={16} />
                      </div>
                    </div>
                  ))}

                  <div className="absolute top-8 right-8 bg-white/80 backdrop-blur-xl px-5 py-2.5 rounded-2xl text-[11px] font-black text-slate-800 uppercase tracking-widest border border-white/50 shadow-2xl flex items-center gap-3">
                    <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></span>
                    Strona {page.pageNumber} z {pages.length}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <style>{`
        @keyframes progress-indefinite {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-progress-indefinite {
          animation: progress-indefinite 1.5s infinite ease-in-out;
        }
        .scrollbar-thin::-webkit-scrollbar {
          width: 5px;
        }
        .scrollbar-thin::-webkit-scrollbar-track {
          background: transparent;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 10px;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover {
          background: #cbd5e1;
        }
      `}</style>
    </div>
  );
}
