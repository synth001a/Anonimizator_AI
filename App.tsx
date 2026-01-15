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
  Lock
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

  useEffect(() => {
    const checkKeyStatus = async () => {
      // @ts-ignore
      if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
        // @ts-ignore
        const result = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(result);
      } else {
        // Jeśli nie ma mechanizmu selekcji, sprawdzamy czy process.env.API_KEY istnieje
        setHasApiKey(!!process.env.API_KEY && process.env.API_KEY !== 'UNDEFINED');
      }
    };
    checkKeyStatus();
  }, []);

  const handleOpenKeySelector = async () => {
    // @ts-ignore
    if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
      // @ts-ignore
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
      setError(null);
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
        setProcessingStatus(`AI skanuje stronę ${page.pageNumber}...`);
        const base64 = page.imageUrl.split(',')[1];
        const results = await detectPiiInImage(base64, settings.categories, settings.customKeywords);

        results.forEach((res, idx) => {
          newRedactions.push({
            id: `r-${page.pageNumber}-${idx}-${Date.now()}`,
            category: res.category,
            text: typeof res.text === 'object' ? JSON.stringify(res.text) : String(res.text || ''),
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
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadRedactedPdf = async () => {
    if (pages.length === 0) return;
    setIsProcessing(true);
    setProcessingStatus('Pobieranie...');
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
      setError("Błąd eksportu: " + err.message);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans text-slate-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-xl">
            <ShieldCheck className="text-white w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">AnonimizatorPDF.AI</h1>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={handleOpenKeySelector}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all font-bold text-sm ${
              hasApiKey ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-500 text-white shadow-lg'
            }`}
          >
            <Key size={18} />
            {hasApiKey ? 'AI Aktywne' : 'Konfiguruj Klucz API'}
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
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-10 text-center border border-slate-100">
              <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Lock size={40} />
              </div>
              <h2 className="text-2xl font-bold text-slate-800 mb-4">Wymagany Klucz API</h2>
              <p className="text-slate-500 mb-8 leading-relaxed">
                Aby korzystać z darmowej anonimizacji AI, musisz połączyć swój klucz Gemini. 
                Możesz go wygenerować za darmo w <a href="https://aistudio.google.com/" target="_blank" className="text-indigo-600 underline">Google AI Studio</a>.
              </p>
              <button 
                onClick={handleOpenKeySelector}
                className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 flex items-center justify-center gap-2"
              >
                <Key size={20} />
                Podłącz klucz i zacznij
              </button>
            </div>
          </div>
        ) : (
          <>
            <aside className="w-80 border-r border-slate-200 bg-white overflow-y-auto p-6 space-y-8 flex flex-col">
              {error && (
                <div className="bg-red-50 border border-red-200 p-4 rounded-xl flex gap-3 text-red-700 text-xs animate-pulse">
                  <AlertTriangle className="shrink-0" size={18} />
                  <p>{error}</p>
                </div>
              )}

              <div className="flex-1 space-y-6">
                <section>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Settings size={12} /> Kategorie Danych
                  </div>
                  <div className="space-y-1">
                    {Object.values(PiiCategory).map(cat => (
                      <label key={cat} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 cursor-pointer group transition-colors">
                        <input 
                          type="checkbox" 
                          className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                          checked={settings.categories.includes(cat)}
                          onChange={() => setSettings(s => ({...s, categories: s.categories.includes(cat) ? s.categories.filter(c => c !== cat) : [...s.categories, cat]}))}
                        />
                        <span className="text-sm font-medium text-slate-600 group-hover:text-slate-900">{cat}</span>
                      </label>
                    ))}
                  </div>
                </section>

                <section>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Słowa kluczowe</div>
                  <div className="flex gap-2">
                    <input 
                      type="text" value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)}
                      placeholder="Dodaj frazę..."
                      className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-2"
                      onKeyDown={(e) => e.key === 'Enter' && newKeyword && (setSettings(s => ({...s, customKeywords: [...s.customKeywords, newKeyword]})), setNewKeyword(''))}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {settings.customKeywords.map(k => (
                      <span key={k} className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1">
                        {k}
                        <button onClick={() => setSettings(s => ({...s, customKeywords: s.customKeywords.filter(x => x !== k)}))}><Trash2 size={10} /></button>
                      </span>
                    ))}
                  </div>
                </section>

                {redactions.length > 0 && (
                  <section className="pt-4 border-t border-slate-100">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Podgląd danych</span>
                      <button onClick={() => setShowSensitive(!showSensitive)} className="text-indigo-600 p-1">
                        {showSensitive ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                      {redactions.map(r => (
                        <div key={r.id} className="text-[11px] p-2 bg-slate-50 rounded border border-slate-100 flex justify-between items-center">
                          <span className={showSensitive ? 'text-slate-700 font-medium' : 'bg-slate-300 text-transparent rounded px-1'}>
                            {String(r.text)}
                          </span>
                          <button onClick={() => setRedactions(prev => prev.filter(red => red.id !== r.id))} className="text-slate-300 hover:text-red-500">
                            <Trash2 size={12} />
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
                  className="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-slate-800 transition-all shadow-xl disabled:bg-slate-200 disabled:shadow-none flex items-center justify-center gap-3"
                >
                  {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <ShieldCheck size={20} />}
                  {isProcessing ? 'Pracuję...' : 'Uruchom AI'}
                </button>
                {processingStatus && <p className="mt-3 text-center text-[10px] text-indigo-600 font-bold animate-pulse">{processingStatus}</p>}
              </div>
            </aside>

            <section className="flex-1 bg-slate-100 overflow-y-auto p-12 flex flex-col items-center">
              {!file ? (
                <div className="text-center mt-20">
                  <div className="w-20 h-20 bg-white rounded-3xl shadow-xl flex items-center justify-center mx-auto mb-6 text-slate-200">
                    <FileUp size={40} />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-800">Wgraj dokument PDF</h2>
                  <p className="text-slate-500 mt-2">Przeciągnij plik tutaj lub użyj przycisku na górze.</p>
                </div>
              ) : (
                <div className="space-y-12 max-w-4xl w-full pb-32">
                  {pages.map(page => (
                    <div 
                      key={page.pageNumber} 
                      className="relative bg-white shadow-2xl rounded-xl overflow-hidden mx-auto border border-slate-200" 
                      style={{ width: page.width, height: page.height }}
                    >
                      <img src={page.imageUrl} className="absolute inset-0 w-full h-full object-contain" alt={`Strona ${page.pageNumber}`} />
                      
                      {redactions.filter(r => r.pageNumber === page.pageNumber).map(red => (
                        <div 
                          key={red.id} 
                          className="absolute bg-black group cursor-pointer hover:ring-2 hover:ring-red-400 transition-all z-10"
                          onClick={() => setRedactions(p => p.filter(r => r.id !== red.id))}
                          style={{ 
                            top: `${red.box.ymin / 10}%`, 
                            left: `${red.box.xmin / 10}%`, 
                            height: `${(red.box.ymax - red.box.ymin) / 10}%`, 
                            width: `${(red.box.xmax - red.box.xmin) / 10}%` 
                          }}
                        >
                          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-red-500/20 flex items-center justify-center">
                            <Trash2 className="text-white" size={16} />
                          </div>
                        </div>
                      ))}

                      <div className="absolute top-4 right-4 bg-white/90 backdrop-blur px-3 py-1.5 rounded-full text-[10px] font-black text-slate-800 shadow-sm border border-slate-100 uppercase">
                        Strona {page.pageNumber}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
