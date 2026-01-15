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

  useEffect(() => {
    const checkKey = async () => {
      const envKey = process.env.API_KEY;
      if (envKey && envKey !== 'UNDEFINED' && envKey !== '') {
        setHasApiKey(true);
      }
      // @ts-ignore
      else if (window.aistudio?.hasSelectedApiKey) {
        // @ts-ignore
        const selected = await window.aistudio.hasSelectedApiKey();
        if (selected) setHasApiKey(true);
      }
    };
    checkKey();
  }, []);

  const handleOpenKeySelector = async () => {
    // @ts-ignore
    if (window.aistudio?.openSelectKey) {
      // @ts-ignore
      await window.aistudio.openSelectKey();
    }
    setHasApiKey(true);
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
        setProcessingStatus(`Analiza strony ${page.pageNumber}...`);
        const base64 = page.imageUrl.split(',')[1];
        const results = await detectPiiInImage(base64, settings.categories, settings.customKeywords);

        results.forEach((res, idx) => {
          newRedactions.push({
            id: `r-${page.pageNumber}-${idx}-${Date.now()}`,
            category: res.category,
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
      setProcessingStatus('Analiza ukończona!');
      setTimeout(() => setProcessingStatus(''), 3000);
    } catch (err: any) {
      setError(err.message);
      if (err.message.includes("Klucz API") || err.message.includes("autoryzacji")) {
        setHasApiKey(false);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadRedactedPdf = async () => {
    if (pages.length === 0) return;
    setIsProcessing(true);
    setProcessingStatus('Generowanie pliku...');
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
      setError("Błąd pobierania: " + err.message);
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  if (!hasApiKey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6 font-sans">
        <div className="max-w-md w-full bg-white rounded-[2.5rem] shadow-2xl p-10 text-center border border-slate-100 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-2 bg-indigo-600"></div>
          <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-3xl flex items-center justify-center mx-auto mb-8">
            <Lock size={40} />
          </div>
          <h2 className="text-3xl font-black text-slate-800 mb-4 tracking-tight">Anonimizator.AI</h2>
          <p className="text-slate-500 mb-8 leading-relaxed text-sm">
            Podłącz klucz Gemini API, aby bezpiecznie anonimizować swoje dokumenty przy użyciu AI.
          </p>
          <button 
            onClick={handleOpenKeySelector}
            className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 flex items-center justify-center gap-3 active:scale-95"
          >
            <Key size={20} />
            Podłącz klucz i zacznij
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans text-slate-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 px-8 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <div className="bg-indigo-600 p-2.5 rounded-xl">
            <ShieldCheck className="text-white w-6 h-6" />
          </div>
          <h1 className="text-xl font-black tracking-tight">Anonimizator.AI</h1>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            disabled={isProcessing}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-all font-bold text-sm"
          >
            <FileUp size={18} />
            {file ? 'Zmień plik' : 'Wgraj PDF'}
          </button>
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".pdf" />

          {redactions.length > 0 && (
            <button 
              disabled={isProcessing}
              onClick={downloadRedactedPdf}
              className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all font-bold text-sm"
            >
              <Download size={18} />
              Pobierz PDF
            </button>
          )}

          <button onClick={() => setHasApiKey(false)} className="p-2 text-slate-400 hover:text-slate-600">
            <Settings size={18} />
          </button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <aside className="w-80 border-r border-slate-200 bg-white overflow-y-auto p-8 space-y-8 flex flex-col">
          {error && (
            <div className="bg-red-50 border border-red-200 p-4 rounded-xl flex gap-3 text-red-700 text-xs">
              <AlertTriangle className="shrink-0" size={18} />
              <p>{error}</p>
            </div>
          )}

          <div className="flex-1 space-y-8">
            <section>
              <div className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4">Ustawienia RODO</div>
              <div className="space-y-1">
                {Object.values(PiiCategory).map(cat => (
                  <label key={cat} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-all">
                    <input 
                      type="checkbox" 
                      className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                      checked={settings.categories.includes(cat)}
                      onChange={() => setSettings(s => ({...s, categories: s.categories.includes(cat) ? s.categories.filter(c => c !== cat) : [...s.categories, cat]}))}
                    />
                    <span className="text-[13px] font-bold text-slate-600">{cat}</span>
                  </label>
                ))}
              </div>
            </section>

            <section>
              <div className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4">Własne frazy</div>
              <input 
                type="text" value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)}
                placeholder="Np. nazwa firmy..."
                className="w-full text-sm border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500"
                onKeyDown={(e) => e.key === 'Enter' && newKeyword && (setSettings(s => ({...s, customKeywords: [...s.customKeywords, newKeyword]})), setNewKeyword(''))}
              />
            </section>

            {redactions.length > 0 && (
              <section className="pt-8 border-t border-slate-100">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Wykryte ({redactions.length})</span>
                  <button onClick={() => setShowSensitive(!showSensitive)} className="text-indigo-600 p-1 bg-indigo-50 rounded-lg">
                    {showSensitive ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="space-y-1 max-h-64 overflow-y-auto pr-2">
                  {redactions.map(r => (
                    <div key={r.id} className="text-[10px] p-2 bg-slate-50 rounded-lg border border-slate-100 flex justify-between items-center group">
                      <span className={showSensitive ? 'text-slate-800 font-bold' : 'bg-slate-200 text-transparent rounded px-1'}>
                        {String(r.text)}
                      </span>
                      <button onClick={() => setRedactions(prev => prev.filter(red => red.id !== r.id))} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100">
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
              className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-sm hover:bg-slate-800 transition-all shadow-xl disabled:bg-slate-100 disabled:text-slate-300 flex items-center justify-center gap-3"
            >
              {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <ShieldCheck size={20} />}
              {isProcessing ? 'Analizuję...' : 'Uruchom AI'}
            </button>
            {processingStatus && <p className="mt-3 text-center text-[11px] text-indigo-600 font-bold animate-pulse">{processingStatus}</p>}
          </div>
        </aside>

        <section className="flex-1 bg-slate-100 overflow-y-auto p-12 flex flex-col items-center">
          {!file ? (
            <div className="text-center mt-32 max-w-sm opacity-50">
              <div className="w-20 h-20 bg-white rounded-3xl shadow-xl flex items-center justify-center mx-auto mb-8 text-slate-300">
                <FileUp size={40} />
              </div>
              <h2 className="text-2xl font-black text-slate-800 tracking-tight">Gotowy do pracy</h2>
              <p className="text-slate-500 font-medium">Wgraj dokument PDF, aby rozpocząć anonimizację.</p>
            </div>
          ) : (
            <div className="space-y-16 max-w-4xl w-full pb-48">
              {pages.map(page => (
                <div 
                  key={page.pageNumber} 
                  className="relative bg-white shadow-2xl rounded-2xl overflow-hidden mx-auto border border-slate-200" 
                  style={{ width: page.width, height: page.height }}
                >
                  <img src={page.imageUrl} className="absolute inset-0 w-full h-full object-contain" alt={`Strona ${page.pageNumber}`} />
                  
                  {redactions.filter(r => r.pageNumber === page.pageNumber).map(red => (
                    <div 
                      key={red.id} 
                      className="absolute bg-black group cursor-pointer hover:ring-2 hover:ring-red-500 transition-all z-10"
                      onClick={() => setRedactions(p => p.filter(r => r.id !== red.id))}
                      style={{ 
                        top: `${red.box.ymin / 10}%`, 
                        left: `${red.box.xmin / 10}%`, 
                        height: `${(red.box.ymax - red.box.ymin) / 10}%`, 
                        width: `${(red.box.xmax - red.box.xmin) / 10}%` 
                      }}
                    >
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-red-500/30 flex items-center justify-center">
                        <Trash2 className="text-white" size={16} />
                      </div>
                    </div>
                  ))}

                  <div className="absolute top-6 right-6 bg-white shadow-xl px-4 py-2 rounded-xl text-[11px] font-black text-slate-800 uppercase tracking-widest border border-slate-100">
                    Strona {page.pageNumber} z {pages.length}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
