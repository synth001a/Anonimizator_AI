
import React, { useState, useCallback, useRef } from 'react';
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
  AlertTriangle
} from 'lucide-react';
import { PiiCategory, RedactionMark, PDFPageData, RedactionSettings } from './types';
import { detectPiiInImage } from './geminiService';

// Initialize PDF.js
// @ts-ignore
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

export default function App() {
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
    } catch (error) {
      console.error("PDF Load Error:", error);
      setError("Nie udało się otworzyć pliku PDF. Upewnij się, że plik nie jest uszkodzony.");
    } finally {
      setIsProcessing(false);
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
      setProcessingStatus('Analiza zakończona pomyślnie!');
      setTimeout(() => setProcessingStatus(''), 4000);
    } catch (err: any) {
      console.error("Anonymization Error:", err);
      setError("Wystąpił błąd podczas analizy przez AI. Spróbuj ponownie.");
    } finally {
      setIsProcessing(false);
    }
  };

  const clearAllRedactions = () => {
    if (confirm('Czy na pewno chcesz usunąć wszystkie zaznaczenia?')) {
      setRedactions([]);
    }
  };

  const toggleCategory = (cat: PiiCategory) => {
    setSettings(prev => ({
      ...prev,
      categories: prev.categories.includes(cat)
        ? prev.categories.filter(c => c !== cat)
        : [...prev.categories, cat]
    }));
  };

  const addKeyword = () => {
    if (newKeyword.trim()) {
      setSettings(prev => ({
        ...prev,
        customKeywords: [...prev.customKeywords, newKeyword.trim()]
      }));
      setNewKeyword('');
    }
  };

  const removeKeyword = (keyword: string) => {
    setSettings(prev => ({
      ...prev,
      customKeywords: prev.customKeywords.filter(k => k !== keyword)
    }));
  };

  const deleteRedaction = (id: string) => {
    setRedactions(prev => prev.filter(r => r.id !== id));
  };

  const downloadRedactedPdf = async () => {
    if (pages.length === 0) return;
    
    setProcessingStatus('Generowanie PDF...');
    setIsProcessing(true);

    try {
      // @ts-ignore
      const { jsPDF } = await import('jspdf');
      
      const firstPage = pages[0];
      const doc = new jsPDF({
        orientation: firstPage.width > firstPage.height ? 'l' : 'p',
        unit: 'px',
        format: [firstPage.width, firstPage.height]
      });

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (i > 0) {
          doc.addPage([page.width, page.height], page.width > page.height ? 'l' : 'p');
        }
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

      const fileName = file ? file.name.replace('.pdf', '_anonimizowany.pdf') : 'dokument_anonimizowany.pdf';
      doc.save(fileName);
      setProcessingStatus('Pobieranie rozpoczęte!');
    } catch (error) {
      console.error("PDF Generation Error:", error);
      setError("Błąd podczas generowania pliku PDF.");
    } finally {
      setIsProcessing(false);
      setTimeout(() => setProcessingStatus(''), 2000);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-xl shadow-indigo-200 shadow-lg">
            <ShieldCheck className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 leading-none">AnonimizatorPDF.AI</h1>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">v1.2 • Bezpieczne Dane</span>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            disabled={isProcessing}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all font-medium disabled:opacity-50"
          >
            <FileUp size={18} />
            {file ? 'Zmień dokument' : 'Wczytaj plik PDF'}
          </button>
          
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            className="hidden" 
            accept=".pdf"
          />

          {redactions.length > 0 && (
            <button 
              disabled={isProcessing}
              onClick={downloadRedactedPdf}
              className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all font-bold shadow-lg shadow-indigo-100 disabled:bg-slate-400"
            >
              <Download size={18} />
              Pobierz PDF
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <aside className="w-80 border-r border-slate-200 bg-white overflow-y-auto p-6 space-y-8 print:hidden flex flex-col">
          <section className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
            <div className="flex items-center gap-2 mb-2 text-indigo-800 font-bold text-sm uppercase tracking-tight">
              <Info size={16} />
              Instrukcja
            </div>
            <ol className="text-xs text-indigo-700 space-y-2 list-decimal list-inside leading-relaxed opacity-90">
              <li>Wgraj dokument PDF.</li>
              <li>Wybierz kategorie danych.</li>
              <li>Kliknij <strong>Uruchom AI</strong>.</li>
              <li>Kliknij na pole, aby je usunąć ręcznie.</li>
            </ol>
          </section>

          {error && (
            <div className="bg-red-50 border border-red-100 p-3 rounded-lg flex gap-3 text-red-700 text-xs animate-in fade-in slide-in-from-top-2 duration-300">
              <AlertTriangle className="shrink-0" size={16} />
              <div>
                <p className="font-bold mb-1">Uwaga!</p>
                <p>{error}</p>
              </div>
            </div>
          )}

          <div className="flex-1 space-y-8 overflow-y-auto pr-1">
            <section>
              <div className="flex items-center gap-2 mb-4 text-slate-500 font-bold uppercase text-[10px] tracking-widest">
                <Settings size={14} />
                Konfiguracja AI
              </div>
              <div className="space-y-1">
                {Object.values(PiiCategory).map(cat => (
                  <label key={cat} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors group">
                    <input 
                      type="checkbox" 
                      checked={settings.categories.includes(cat)}
                      onChange={() => toggleCategory(cat)}
                      className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-slate-700 group-hover:text-indigo-600 transition-colors">{cat}</span>
                  </label>
                ))}
              </div>
            </section>

            <section>
              <div className="flex items-center gap-2 mb-3 text-slate-500 font-bold uppercase text-[10px] tracking-widest">
                <AlertCircle size={14} />
                Własne frazy
              </div>
              <div className="flex gap-2 mb-3">
                <input 
                  type="text"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  placeholder="np. Tajna Firma"
                  className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
                />
                <button 
                  onClick={addKeyword}
                  className="bg-indigo-50 text-indigo-600 px-3 py-2 rounded-lg font-bold text-xs hover:bg-indigo-100 transition-colors"
                >
                  Dodaj
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {settings.customKeywords.map(k => (
                  <span key={k} className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 text-slate-600 rounded-md text-[10px] font-bold">
                    {k}
                    <button onClick={() => removeKeyword(k)}><Trash2 size={10} /></button>
                  </span>
                ))}
              </div>
            </section>

            {redactions.length > 0 && (
              <section className="pt-6 border-t border-slate-100">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Wykryto ({redactions.length})</h3>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setShowSensitive(!showSensitive)}
                      className="text-indigo-600 hover:bg-indigo-50 p-1 rounded transition-colors"
                      title={showSensitive ? 'Ukryj tekst' : 'Pokaż tekst'}
                    >
                      {showSensitive ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button 
                      onClick={clearAllRedactions}
                      className="text-red-500 hover:bg-red-50 p-1 rounded transition-colors"
                      title="Resetuj"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                  {redactions.map(r => (
                    <div key={r.id} className="text-[11px] p-2.5 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-between group animate-in fade-in slide-in-from-left-2">
                      <div className="truncate pr-2">
                        <span className="font-bold text-indigo-600 block text-[9px] uppercase tracking-tighter">{r.category}</span>
                        <span className={showSensitive ? 'text-slate-800' : 'bg-slate-200 text-transparent rounded px-1 select-none'}>
                          {r.text || '...'}
                        </span>
                      </div>
                      <button onClick={() => deleteRedaction(r.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
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
              className="w-full bg-slate-900 text-white py-3.5 rounded-xl font-bold hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 disabled:bg-slate-200 disabled:shadow-none disabled:cursor-not-allowed flex items-center justify-center gap-3 active:scale-95"
            >
              {isProcessing && !processingStatus.includes('Generowanie') ? (
                <Loader2 className="animate-spin" size={20} />
              ) : (
                <ShieldCheck size={20} />
              )}
              {isProcessing && !processingStatus.includes('Generowanie') ? 'Analizowanie...' : 'Uruchom AI'}
            </button>
            {processingStatus && (
              <p className="mt-3 text-center text-[11px] text-indigo-600 font-bold animate-pulse">
                {processingStatus}
              </p>
            )}
          </div>
        </aside>

        <section className="flex-1 bg-slate-100 overflow-y-auto p-12 flex flex-col items-center gap-8 relative scroll-smooth">
          {!file && !isProcessing && (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-6 animate-in fade-in zoom-in duration-500">
              <div className="w-24 h-24 bg-white rounded-3xl shadow-xl flex items-center justify-center text-slate-300">
                <FileUp size={48} className="stroke-1" />
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-slate-800">Witaj w AnonimizatorPDF.AI</p>
                <p className="text-sm text-slate-500 mt-2 max-w-xs">Twoje dokumenty są bezpieczne. Dane przetwarzane są tymczasowo w pamięci RAM przeglądarki i przez model Gemini AI.</p>
              </div>
            </div>
          )}

          <div className="space-y-12 max-w-4xl w-full pb-20">
            {pages.map(page => (
              <div 
                key={page.pageNumber} 
                className="relative bg-white shadow-[0_20px_50px_rgba(0,0,0,0.1)] rounded-lg overflow-hidden mx-auto border border-slate-200 transition-all hover:shadow-[0_30px_60px_rgba(0,0,0,0.15)]"
                style={{ width: page.width, height: page.height, transform: 'scale(1)', transformOrigin: 'top center' }}
              >
                <img 
                  src={page.imageUrl} 
                  className="absolute inset-0 w-full h-full object-contain" 
                  alt={`Strona ${page.pageNumber}`} 
                  loading="lazy"
                />
                
                {redactions
                  .filter(r => r.pageNumber === page.pageNumber)
                  .map(red => (
                    <div 
                      key={red.id}
                      className="absolute bg-black group cursor-pointer transition-all hover:ring-2 hover:ring-red-400"
                      onClick={() => deleteRedaction(red.id)}
                      title={`Usuń: ${red.category}`}
                      style={{
                        top: `${red.box.ymin / 10}%`,
                        left: `${red.box.xmin / 10}%`,
                        height: `${(red.box.ymax - red.box.ymin) / 10}%`,
                        width: `${(red.box.xmax - red.box.xmin) / 10}%`,
                      }}
                    >
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-red-500/20 flex items-center justify-center">
                         <Trash2 className="text-white drop-shadow-md" size={14} />
                      </div>
                    </div>
                  ))}
                
                <div className="absolute top-6 right-6 bg-white/80 backdrop-blur-md px-3 py-1.5 rounded-full text-[10px] font-black text-slate-800 shadow-sm border border-slate-200">
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
