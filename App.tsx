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
  RefreshCw
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

  // Sprawdzanie czy klucz jest już dostępny w systemie
  useEffect(() => {
    const checkKeyStatus = async () => {
      try {
        // @ts-ignore
        if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
          // @ts-ignore
          const result = await window.aistudio.hasSelectedApiKey();
          if (result) {
            setHasApiKey(true);
            return;
          }
        }
        
        // Jeśli nie ma mechanizmu selekcji, sprawdzamy process.env
        const envKey = process.env.API_KEY;
        if (envKey && envKey !== 'UNDEFINED' && envKey.length > 5) {
          setHasApiKey(true);
        }
      } catch (e) {
        console.error("Błąd sprawdzania statusu klucza:", e);
      }
    };
    checkKeyStatus();
  }, []);

  const handleOpenKeySelector = async () => {
    setError(null);
    try {
      // @ts-ignore
      if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
        // @ts-ignore
        await window.aistudio.openSelectKey();
        // Zgodnie z wytycznymi: zakładamy sukces po wywołaniu okna
        setHasApiKey(true);
      } else {
        // Fallback: jeśli nie jesteśmy w środowisku AI Studio, spróbujmy po prostu "wpuścić" użytkownika 
        // jeśli API_KEY jest zdefiniowany w środowisku
        const envKey = process.env.API_KEY;
        if (envKey && envKey !== 'UNDEFINED') {
          setHasApiKey(true);
        } else {
          setError("Twój system nie wspiera automatycznego wyboru klucza. Upewnij się, że masz ustawiony API_KEY w ustawieniach projektu.");
        }
      }
    } catch (e: any) {
      setError("Nie udało się otworzyć okna wyboru klucza: " + e.message);
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
        setProcessingStatus(`Przygotowanie strony ${i}/${pdf.numPages}...`);
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
      setError("Błąd wczytywania PDF: " + err.message);
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
        setProcessingStatus(`AI skanuje stronę ${page.pageNumber}...`);
        const base64 = page.imageUrl.split(',')[1];
        const results = await detectPiiInImage(base64, settings.categories, settings.customKeywords);

        results.forEach((res, idx) => {
          newRedactions.push({
            id: `r-${page.pageNumber}-${idx}-${Date.now()}`,
            category: res.category,
            // Naprawa błędu React #31: rzutowanie wszystkiego na string
            text: res.text && typeof res.text === 'object' ? JSON.stringify(res.text) : String(res.text || ''),
            pageNumber: page.pageNumber,
            confidence: 1,
            box: { 
              ymin: Number(res.box_2d[0]), 
              xmin: Number(res.box_2d[1]), 
              ymax: Number(res.box_2d[2]), 
              xmax: Number(res.box_2d[3]) 
            }
          });
        });
      }
      setRedactions(newRedactions);
      setProcessingStatus('Analiza ukończona!');
      setTimeout(() => setProcessingStatus(''), 3000);
    } catch (err: any) {
      setError(err.message);
      // Jeśli klucz jest nieaktywny/niepoprawny, resetujemy stan klucza
      if (err.message.includes("not found") || err.message.includes("API key")) {
        setHasApiKey(false);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadRedactedPdf = async () => {
    if (pages.length === 0) return;
    setIsProcessing(true);
    setProcessingStatus('Generowanie PDF...');
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
      doc.save(`${file?.name.replace('.pdf', '')}_anonimizowany.pdf`);
    } catch (err: any) {
      setError("Błąd pobierania: " + err.message);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans text-slate-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-xl shadow-lg">
            <ShieldCheck className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">AnonimizatorPDF.AI</h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase">Automatyczne RODO</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={handleOpenKeySelector}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all font-bold text-sm ${
              hasApiKey ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-amber-500 text-white shadow-lg shadow-amber-200 hover:bg-amber-600'
            }`}
          >
            {hasApiKey ? <ShieldCheck size={18} /> : <Key size={18} />}
            {hasApiKey ? 'Połączono z AI' : 'Konfiguruj Klucz API'}
          </button>
          
          {hasApiKey && (
            <>
              <button 
                disabled={isProcessing}
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all font-medium text-sm disabled:opacity-50"
              >
                <FileUp size={18} />
                {file ? 'Zmień Plik' : 'Wgraj PDF'}
              </button>
              <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".pdf" />

              {redactions.length > 0 && (
                <button 
                  disabled={isProcessing}
                  onClick={downloadRedactedPdf}
                  className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all font-bold text-sm shadow-lg shadow-indigo-100"
                >
                  <Download size={18} />
                  Pobierz Wynik
                </button>
              )}
            </>
          )}
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {!hasApiKey ? (
          <div className="flex-1 flex items-center justify-center p-6 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-50/50 via-slate-50 to-slate-50">
            <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-10 text-center border border-slate-100 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"></div>
              <div className="w-24 h-24 bg-indigo-50 text-indigo-600 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-inner">
                <Lock size={48} />
              </div>
              <h2 className="text-2xl font-black text-slate-800 mb-4 tracking-tight">Wymagany Klucz API</h2>
              <p className="text-slate-500 mb-8 leading-relaxed text-sm">
                Aplikacja wykorzystuje model Gemini do analizy dokumentów. 
                Połącz swój darmowy klucz z <a href="https://aistudio.google.com/" target="_blank" className="text-indigo-600 font-bold hover:underline">Google AI Studio</a>, aby odblokować funkcje.
              </p>
              
              {error && (
                <div className="mb-6 p-4 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100 flex items-center gap-2">
                  <AlertCircle size={14} className="shrink-0" />
                  {error}
                </div>
              )}

              <button 
                onClick={handleOpenKeySelector}
                className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 flex items-center justify-center gap-3 active:scale-[0.98]"
              >
                <Key size={20} />
                Podłącz klucz i zacznij
              </button>
              
              <p className="mt-6 text-[10px] text-slate-400 font-medium">
                Twoje dane nie opuszczają przeglądarki w celach innych niż analiza przez model Gemini.
              </p>
            </div>
          </div>
        ) : (
          <>
            <aside className="w-84 border-r border-slate-200 bg-white overflow-y-auto p-6 space-y-8 flex flex-col">
              {error && (
                <div className="bg-red-50 border border-red-200 p-4 rounded-xl flex gap-3 text-red-700 text-xs animate-in fade-in slide-in-from-top-2">
                  <AlertTriangle className="shrink-0" size={18} />
                  <div>
                    <p className="font-bold">Błąd AI</p>
                    <p className="opacity-90">{error}</p>
                    <button 
                      onClick={handleOpenKeySelector}
                      className="mt-2 text-indigo-600 font-bold flex items-center gap-1 hover:underline"
                    >
                      <RefreshCw size={10} /> Spróbuj wybrać klucz ponownie
                    </button>
                  </div>
                </div>
              )}

              <div className="flex-1 space-y-8">
                <section>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Settings size={12} className="text-indigo-500" /> Co mamy zanonimizować?
                  </div>
                  <div className="grid grid-cols-1 gap-1">
                    {Object.values(PiiCategory).map(cat => (
                      <label key={cat} className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 cursor-pointer group transition-all border border-transparent hover:border-slate-100">
                        <input 
                          type="checkbox" 
                          className="w-5 h-5 text-indigo-600 rounded-lg border-slate-300 focus:ring-indigo-500 transition-all"
                          checked={settings.categories.includes(cat)}
                          onChange={() => setSettings(s => ({...s, categories: s.categories.includes(cat) ? s.categories.filter(c => c !== cat) : [...s.categories, cat]}))}
                        />
                        <span className="text-sm font-semibold text-slate-600 group-hover:text-slate-900">{cat}</span>
                      </label>
                    ))}
                  </div>
                </section>

                <section>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Info size={12} className="text-indigo-500" /> Własne słowa
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="text" value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)}
                      placeholder="Wpisz i naciśnij Enter..."
                      className="flex-1 text-xs border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                      onKeyDown={(e) => e.key === 'Enter' && newKeyword && (setSettings(s => ({...s, customKeywords: [...s.customKeywords, newKeyword]})), setNewKeyword(''))}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {settings.customKeywords.map(k => (
                      <span key={k} className="bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-2 border border-indigo-100">
                        {k}
                        <button onClick={() => setSettings(s => ({...s, customKeywords: s.customKeywords.filter(x => x !== k)}))} className="hover:text-indigo-800 transition-colors">
                          <Trash2 size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                </section>

                {redactions.length > 0 && (
                  <section className="pt-6 border-t border-slate-100">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Wykryte elementy ({redactions.length})</span>
                      <button 
                        onClick={() => setShowSensitive(!showSensitive)} 
                        className="text-indigo-600 p-2 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
                        title={showSensitive ? "Ukryj podgląd" : "Pokaż co AI znalazło"}
                      >
                        {showSensitive ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1 scrollbar-thin">
                      {redactions.map(r => (
                        <div key={r.id} className="text-[11px] p-3 bg-slate-50 rounded-xl border border-slate-100 flex justify-between items-center group hover:bg-white hover:shadow-sm transition-all">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[9px] font-bold text-slate-400 uppercase">{r.category}</span>
                            <span className={showSensitive ? 'text-slate-700 font-bold' : 'bg-slate-200 text-transparent rounded px-1 select-none'}>
                              {String(r.text)}
                            </span>
                          </div>
                          <button 
                            onClick={() => setRedactions(prev => prev.filter(red => red.id !== r.id))} 
                            className="text-slate-300 hover:text-red-500 transition-colors p-1"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>

              <div className="pt-6 mt-auto">
                <button 
                  disabled={!file || isProcessing}
                  onClick={startAnonymization}
                  className="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-slate-800 transition-all shadow-xl disabled:bg-slate-200 disabled:shadow-none flex items-center justify-center gap-3 active:scale-[0.98]"
                >
                  {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <ShieldCheck size={20} />}
                  {isProcessing ? 'Analizuję dokument...' : 'Uruchom Anonimizację'}
                </button>
                {processingStatus && (
                  <div className="mt-4 flex flex-col items-center gap-2">
                    <p className="text-[11px] text-indigo-600 font-bold animate-pulse text-center">{processingStatus}</p>
                    <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
                      <div className="bg-indigo-600 h-full animate-progress" style={{ width: '100%' }}></div>
                    </div>
                  </div>
                )}
              </div>
            </aside>

            <section className="flex-1 bg-slate-100 overflow-y-auto p-12 flex flex-col items-center">
              {!file ? (
                <div className="text-center mt-20 animate-in fade-in zoom-in-95 duration-500">
                  <div className="w-24 h-24 bg-white rounded-[2rem] shadow-xl flex items-center justify-center mx-auto mb-8 text-slate-200 border border-slate-50">
                    <FileUp size={48} />
                  </div>
                  <h2 className="text-3xl font-black text-slate-800 tracking-tight">Gotowy do pracy?</h2>
                  <p className="text-slate-500 mt-3 text-lg font-medium">Wgraj dokument PDF, aby rozpocząć proces.</p>
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-8 px-8 py-3 bg-white text-slate-800 rounded-2xl font-bold shadow-lg hover:shadow-xl transition-all border border-slate-200 active:scale-95"
                  >
                    Wybierz plik z dysku
                  </button>
                </div>
              ) : (
                <div className="space-y-12 max-w-4xl w-full pb-32 animate-in fade-in slide-in-from-bottom-4 duration-700">
                  {pages.map(page => (
                    <div 
                      key={page.pageNumber} 
                      className="relative bg-white shadow-2xl rounded-2xl overflow-hidden mx-auto border border-slate-200 group" 
                      style={{ width: page.width, height: page.height }}
                    >
                      <img src={page.imageUrl} className="absolute inset-0 w-full h-full object-contain" alt={`Strona ${page.pageNumber}`} />
                      
                      <div className="absolute inset-0 pointer-events-none">
                        {redactions.filter(r => r.pageNumber === page.pageNumber).map(red => (
                          <div 
                            key={red.id} 
                            className="absolute bg-black group-hover:bg-slate-900/90 cursor-pointer hover:ring-2 hover:ring-indigo-400 transition-all z-10 pointer-events-auto rounded-[2px]"
                            onClick={() => setRedactions(p => p.filter(r => r.id !== red.id))}
                            style={{ 
                              top: `${red.box.ymin / 10}%`, 
                              left: `${red.box.xmin / 10}%`, 
                              height: `${(red.box.ymax - red.box.ymin) / 10}%`, 
                              width: `${(red.box.xmax - red.box.xmin) / 10}%` 
                            }}
                          >
                            <div className="absolute inset-0 opacity-0 hover:opacity-100 bg-red-500/10 flex items-center justify-center transition-opacity">
                              <Trash2 className="text-white drop-shadow-md" size={16} />
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="absolute top-6 right-6 bg-white/80 backdrop-blur-md px-4 py-2 rounded-2xl text-[11px] font-black text-slate-800 shadow-xl border border-white/50 uppercase tracking-widest flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse"></span>
                        Strona {page.pageNumber} / {pages.length}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
      
      <style>{`
        @keyframes progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-progress {
          animation: progress 2s infinite ease-in-out;
        }
        .scrollbar-thin::-webkit-scrollbar {
          width: 4px;
        }
        .scrollbar-thin::-webkit-scrollbar-track {
          background: transparent;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 10px;
        }
      `}</style>
    </div>
  );
}
