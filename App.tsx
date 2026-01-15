
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
  CheckCircle2,
  Info,
  RefreshCw,
  AlertTriangle,
  Key
} from 'lucide-react';
import { PiiCategory, RedactionMark, PDFPageData, RedactionSettings } from './types';
import { detectPiiInImage } from './geminiService';

// @ts-ignore
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

declare global {
  // Use the existing global AIStudio type to avoid conflicts with other declarations
  interface Window {
    aistudio: AIStudio;
  }
}

export default function App() {
  const [hasApiKey, setHasApiKey] = useState<boolean>(true);
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
    checkApiKey();
  }, []);

  const checkApiKey = async () => {
    if (window.aistudio) {
      const hasKey = await window.aistudio.hasSelectedApiKey();
      setHasApiKey(hasKey);
    }
  };

  const handleOpenKeySelector = async () => {
    if (window.aistudio) {
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
        setProcessingStatus(`Renderowanie strony ${i} z ${pdf.numPages}...`);
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport }).promise;
        const imageUrl = canvas.toDataURL('image/jpeg', 0.85);
        
        loadedPages.push({
          pageNumber: i,
          imageUrl,
          width: viewport.width,
          height: viewport.height
        });
      }
      setPages(loadedPages);
      setProcessingStatus('');
    } catch (err: any) {
      setError("Błąd wczytywania PDF: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const startAnonymization = async () => {
    if (!hasApiKey) {
      setError("Wymagany klucz API. Kliknij przycisk poniżej, aby go skonfigurować.");
      return;
    }
    if (pages.length === 0) return;
    
    setIsProcessing(true);
    setError(null);
    const newRedactions: RedactionMark[] = [];

    try {
      for (const page of pages) {
        setProcessingStatus(`Analiza strony ${page.pageNumber}...`);
        const base64 = page.imageUrl.split(',')[1];
        const results = await detectPiiInImage(base64, settings.categories, settings.customKeywords);

        results.forEach((res, idx) => {
          newRedactions.push({
            id: `redact-${page.pageNumber}-${idx}-${Date.now()}`,
            category: res.category,
            text: res.text,
            pageNumber: page.pageNumber,
            confidence: 0.9,
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
      setProcessingStatus('Zakończono!');
      setTimeout(() => setProcessingStatus(''), 3000);
    } catch (err: any) {
      if (err.message.includes("RE-AUTH")) {
        setHasApiKey(false);
        setError("Klucz wygasł lub jest nieprawidłowy. Wybierz go ponownie.");
      } else {
        setError(err.message);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadRedactedPdf = async () => {
    if (pages.length === 0) return;
    setProcessingStatus('Generowanie PDF...');
    setIsProcessing(true);
    try {
      const { jsPDF } = await import('jspdf');
      const firstPage = pages[0];
      const doc = new jsPDF({
        orientation: firstPage.width > firstPage.height ? 'l' : 'p',
        unit: 'px',
        format: [firstPage.width, firstPage.height]
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
      doc.save(file?.name.replace('.pdf', '_anonim.pdf') || 'anonim.pdf');
    } catch (err: any) {
      setError("Błąd generowania PDF: " + err.message);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-xl shadow-lg shadow-indigo-100">
            <ShieldCheck className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">AnonimizatorPDF.AI</h1>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">v1.3 • Bezpieczna Analiza</span>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {!hasApiKey && (
            <button 
              onClick={handleOpenKeySelector}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-all font-bold animate-pulse"
            >
              <Key size={18} />
              Konfiguruj Klucz API
            </button>
          )}
          
          <button 
            disabled={isProcessing}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all font-medium disabled:opacity-50"
          >
            <FileUp size={18} />
            {file ? 'Zmień plik' : 'Wgraj PDF'}
          </button>
          
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".pdf" />

          {redactions.length > 0 && (
            <button 
              disabled={isProcessing}
              onClick={downloadRedactedPdf}
              className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all font-bold shadow-lg shadow-indigo-100"
            >
              <Download size={18} />
              Pobierz
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <aside className="w-80 border-r border-slate-200 bg-white overflow-y-auto p-6 space-y-8 flex flex-col">
          {!hasApiKey ? (
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl text-center">
              <AlertCircle className="text-amber-600 mx-auto mb-2" size={24} />
              <p className="text-sm font-bold text-amber-800 mb-3">Wymagana konfiguracja</p>
              <p className="text-xs text-amber-700 mb-4 leading-relaxed">Aby korzystać z AI, musisz wybrać klucz API ze swojego projektu Google Cloud.</p>
              <button 
                onClick={handleOpenKeySelector}
                className="w-full py-2 bg-amber-600 text-white rounded-lg text-xs font-bold hover:bg-amber-700 transition-colors"
              >
                Wybierz Klucz Teraz
              </button>
              <p className="mt-3 text-[10px] text-amber-500 italic">
                Wymagany projekt z włączonym <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="underline">billingiem</a>.
              </p>
            </div>
          ) : (
            <>
              <section className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                <div className="flex items-center gap-2 mb-2 text-indigo-800 font-bold text-sm uppercase">
                  <Info size={16} /> Instrukcja
                </div>
                <ol className="text-xs text-indigo-700 space-y-2 list-decimal list-inside leading-relaxed">
                  <li>Wgraj dokument PDF.</li>
                  <li>Wybierz co AI ma znaleźć.</li>
                  <li>Kliknij <strong>Uruchom AI</strong>.</li>
                </ol>
              </section>

              {error && (
                <div className="bg-red-50 border border-red-100 p-3 rounded-lg flex gap-3 text-red-700 text-xs animate-bounce">
                  <AlertTriangle className="shrink-0" size={16} />
                  <p className="font-medium">{error}</p>
                </div>
              )}

              <div className="flex-1 space-y-8 overflow-y-auto pr-1">
                <section>
                  <div className="flex items-center gap-2 mb-4 text-slate-500 font-bold uppercase text-[10px] tracking-widest">
                    <Settings size={14} /> Konfiguracja AI
                  </div>
                  <div className="space-y-1">
                    {Object.values(PiiCategory).map(cat => (
                      <label key={cat} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors group">
                        <input 
                          type="checkbox" 
                          checked={settings.categories.includes(cat)}
                          onChange={() => setSettings(s => ({...s, categories: s.categories.includes(cat) ? s.categories.filter(c => c !== cat) : [...s.categories, cat]}))}
                          className="w-4 h-4 text-indigo-600 rounded border-slate-300"
                        />
                        <span className="text-sm text-slate-700 group-hover:text-indigo-600">{cat}</span>
                      </label>
                    ))}
                  </div>
                </section>

                <section>
                  <div className="flex items-center gap-2 mb-3 text-slate-500 font-bold uppercase text-[10px] tracking-widest">
                    <AlertCircle size={14} /> Własne frazy
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="text" value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)}
                      placeholder="np. Nazwa Firmy" onKeyDown={(e) => e.key === 'Enter' && (setSettings(s => ({...s, customKeywords: [...s.customKeywords, newKeyword]})), setNewKeyword(''))}
                      className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-2"
                    />
                  </div>
                </section>

                {redactions.length > 0 && (
                  <section className="pt-6 border-t border-slate-100">
                    <div className="flex items-center justify-between mb-4 text-[10px] font-bold text-slate-500 uppercase">
                      <span>Wykryto ({redactions.length})</span>
                      <button onClick={() => setShowSensitive(!showSensitive)} className="text-indigo-600">
                        {showSensitive ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                      {redactions.map(r => (
                        <div key={r.id} className="text-[11px] p-2 bg-slate-50 rounded border flex justify-between group">
                          <span className={showSensitive ? 'text-slate-800' : 'bg-slate-200 text-transparent rounded px-1'}>{r.text || '...'}</span>
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
                  disabled={!file || isProcessing || !hasApiKey}
                  onClick={startAnonymization}
                  className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold hover:bg-slate-800 transition-all shadow-xl disabled:bg-slate-200 flex items-center justify-center gap-3"
                >
                  {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <ShieldCheck size={20} />}
                  {isProcessing ? 'Analizowanie...' : 'Uruchom AI'}
                </button>
                {processingStatus && <p className="mt-3 text-center text-[11px] text-indigo-600 font-bold animate-pulse">{processingStatus}</p>}
              </div>
            </>
          )}
        </aside>

        <section className="flex-1 bg-slate-100 overflow-y-auto p-12 flex flex-col items-center gap-8 relative">
          {!file && (
            <div className="text-center mt-20 text-slate-400">
              <div className="w-24 h-24 bg-white rounded-3xl shadow-xl flex items-center justify-center mx-auto mb-6">
                <FileUp size={48} className="text-slate-200" />
              </div>
              <h2 className="text-xl font-bold text-slate-800">Wgraj dokument, aby rozpocząć</h2>
              <p className="text-sm mt-2">Przeciągnij plik PDF tutaj lub użyj przycisku u góry.</p>
            </div>
          )}

          <div className="space-y-12 max-w-4xl w-full pb-20">
            {pages.map(page => (
              <div key={page.pageNumber} className="relative bg-white shadow-2xl rounded-lg overflow-hidden mx-auto border border-slate-200" style={{ width: page.width, height: page.height }}>
                <img src={page.imageUrl} className="absolute inset-0 w-full h-full object-contain" />
                {redactions.filter(r => r.pageNumber === page.pageNumber).map(red => (
                  <div key={red.id} className="absolute bg-black cursor-pointer hover:ring-2 hover:ring-red-400 transition-all" onClick={() => setRedactions(p => p.filter(r => r.id !== red.id))}
                    style={{ top: `${red.box.ymin / 10}%`, left: `${red.box.xmin / 10}%`, height: `${(red.box.ymax - red.box.ymin) / 10}%`, width: `${(red.box.xmax - red.box.xmin) / 10}%` }} />
                ))}
                <div className="absolute bottom-4 right-4 bg-white/90 backdrop-blur px-3 py-1 rounded-full text-[10px] font-bold shadow-sm">
                  STRONA {page.pageNumber} / {pages.length}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
