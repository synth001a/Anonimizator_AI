
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
  CheckCircle2
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
        const viewport = page.getViewport({ scale: 2.0 }); // Wyższa skala dla lepszej jakości przy pobieraniu
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport }).promise;
        const imageUrl = canvas.toDataURL('image/jpeg', 0.9);
        
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
      alert("Błąd podczas wczytywania pliku PDF.");
    } finally {
      setIsProcessing(false);
    }
  };

  const startAnonymization = async () => {
    if (pages.length === 0) return;

    setIsProcessing(true);
    const newRedactions: RedactionMark[] = [];

    try {
      for (const page of pages) {
        setProcessingStatus(`Analiza strony ${page.pageNumber}...`);
        const base64 = page.imageUrl.split(',')[1];
        const results = await detectPiiInImage(base64, settings.categories, settings.customKeywords);

        results.forEach((res, idx) => {
          newRedactions.push({
            id: `redact-${page.pageNumber}-${idx}`,
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
      setProcessingStatus('Gotowe!');
      setTimeout(() => setProcessingStatus(''), 3000);
    } catch (error) {
      console.error("Anonymization Error:", error);
      alert("Wystąpił błąd podczas anonimizacji.");
    } finally {
      setIsProcessing(false);
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
    
    setProcessingStatus('Generowanie pliku PDF...');
    setIsProcessing(true);

    try {
      // Dynamic import of jsPDF to keep main bundle light
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

        // Add the page image
        doc.addImage(page.imageUrl, 'JPEG', 0, 0, page.width, page.height);

        // Draw redactions
        const pageRedactions = redactions.filter(r => r.pageNumber === page.pageNumber);
        doc.setFillColor(0, 0, 0); // Black

        pageRedactions.forEach(red => {
          // Box coordinates are normalized 0-1000
          const x = (red.box.xmin / 1000) * page.width;
          const y = (red.box.ymin / 1000) * page.height;
          const w = ((red.box.xmax - red.box.xmin) / 1000) * page.width;
          const h = ((red.box.ymax - red.box.ymin) / 1000) * page.height;
          
          doc.rect(x, y, w, h, 'F');
        });
      }

      const fileName = file ? file.name.replace('.pdf', '_anonimizowany.pdf') : 'dokument_anonimizowany.pdf';
      doc.save(fileName);
      setProcessingStatus('Pobrano!');
    } catch (error) {
      console.error("PDF Generation Error:", error);
      alert("Błąd podczas generowania pliku PDF.");
    } finally {
      setIsProcessing(false);
      setTimeout(() => setProcessingStatus(''), 2000);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <ShieldCheck className="text-white w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-slate-800">SecureRedact AI</h1>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            disabled={isProcessing}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors font-medium disabled:opacity-50"
          >
            <FileUp size={18} />
            {file ? 'Zmień plik' : 'Wczytaj PDF'}
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
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium shadow-sm disabled:bg-slate-400"
            >
              {isProcessing && processingStatus.includes('Generowanie') ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <Download size={18} />
              )}
              Pobierz PDF
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* Sidebar Controls */}
        <aside className="w-80 border-r border-slate-200 bg-white overflow-y-auto p-6 space-y-8 print:hidden">
          <section>
            <div className="flex items-center gap-2 mb-4 text-slate-800 font-semibold uppercase text-xs tracking-wider">
              <Settings size={14} />
              Konfiguracja Anonimizacji
            </div>
            
            <div className="space-y-3">
              {Object.values(PiiCategory).map(cat => (
                <label key={cat} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors">
                  <input 
                    type="checkbox" 
                    checked={settings.categories.includes(cat)}
                    onChange={() => toggleCategory(cat)}
                    className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                  />
                  <span className="text-sm text-slate-700">{cat}</span>
                </label>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-3 text-slate-800 font-semibold uppercase text-xs tracking-wider">
              <AlertCircle size={14} />
              Własne Słowa Kluczowe
            </div>
            <div className="flex gap-2 mb-3">
              <input 
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                placeholder="np. PESEL firmy"
                className="flex-1 text-sm border border-slate-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
              />
              <button 
                onClick={addKeyword}
                className="bg-slate-100 p-1.5 rounded-md text-slate-600 hover:bg-slate-200 transition-colors"
              >
                Dodaj
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {settings.customKeywords.map(kw => (
                <span key={kw} className="bg-slate-100 text-slate-700 text-xs px-2 py-1 rounded-full flex items-center gap-1 group">
                  {kw}
                  <button onClick={() => removeKeyword(kw)} className="text-slate-400 hover:text-red-500 transition-colors">
                    <Trash2 size={10} />
                  </button>
                </span>
              ))}
            </div>
          </section>

          <section className="pt-6 border-t border-slate-100">
            <button 
              disabled={!file || isProcessing}
              onClick={startAnonymization}
              className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-md disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isProcessing && !processingStatus.includes('Generowanie') ? <Loader2 className="animate-spin" size={20} /> : <ShieldCheck size={20} />}
              {isProcessing && !processingStatus.includes('Generowanie') ? 'Analizowanie...' : 'Uruchom AI'}
            </button>
            {processingStatus && (
              <p className="mt-3 text-center text-sm text-indigo-600 font-medium animate-pulse">
                {processingStatus}
              </p>
            )}
          </section>

          {redactions.length > 0 && (
            <section className="pt-6 border-t border-slate-100">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-800">Podgląd Danych</h3>
                <button 
                  onClick={() => setShowSensitive(!showSensitive)}
                  className="text-indigo-600 hover:underline text-xs flex items-center gap-1"
                >
                  {showSensitive ? <EyeOff size={14} /> : <Eye size={14} />}
                  {showSensitive ? 'Ukryj' : 'Pokaż'}
                </button>
              </div>
              <div className="space-y-2">
                <p className="text-xs text-slate-500 italic">Wykryto {redactions.length} elementów.</p>
                <div className="max-h-60 overflow-y-auto pr-2 space-y-2">
                  {redactions.map(r => (
                    <div key={r.id} className="text-xs p-2 bg-slate-50 rounded border border-slate-100 flex items-center justify-between group">
                      <div className="truncate pr-2">
                        <span className="font-bold text-indigo-600 block mb-0.5">{r.category}</span>
                        <span className={showSensitive ? '' : 'blur-[2px] select-none'}>{r.text}</span>
                      </div>
                      <button 
                        onClick={() => deleteRedaction(r.id)}
                        className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
        </aside>

        {/* PDF Preview Area */}
        <section className="flex-1 bg-slate-200 overflow-y-auto p-8 flex flex-col items-center gap-8 relative">
          {!file && !isProcessing && (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4">
              <FileUp size={64} className="stroke-1" />
              <div className="text-center">
                <p className="text-lg font-medium text-slate-600">Wgraj dokument PDF, aby rozpocząć</p>
                <p className="text-sm">Obsługujemy dokumenty urzędowe, faktury, umowy i inne.</p>
              </div>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 px-6 py-2 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 transition-all font-medium shadow-md"
              >
                Wybierz plik
              </button>
            </div>
          )}

          {isProcessing && pages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full">
              <div className="relative">
                <Loader2 className="w-16 h-16 text-indigo-600 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <ShieldCheck className="text-indigo-600 w-6 h-6" />
                </div>
              </div>
              <p className="mt-4 text-slate-600 font-medium">{processingStatus}</p>
            </div>
          )}

          <div className="space-y-12 max-w-4xl w-full">
            {pages.map(page => (
              <div 
                key={page.pageNumber} 
                className="relative bg-white shadow-2xl rounded-sm overflow-hidden mx-auto"
                style={{ width: page.width / 1.5, height: page.height / 1.5 }} // Scale preview to fit screen nicely
              >
                <img src={page.imageUrl} className="absolute inset-0 w-full h-full object-contain" alt={`Strona ${page.pageNumber}`} />
                
                {/* Redaction Overlays (Visual Only in Browser) */}
                {redactions
                  .filter(r => r.pageNumber === page.pageNumber)
                  .map(red => (
                    <div 
                      key={red.id}
                      className="absolute bg-black group transition-opacity"
                      style={{
                        top: `${red.box.ymin / 10}%`,
                        left: `${red.box.xmin / 10}%`,
                        height: `${(red.box.ymax - red.box.ymin) / 10}%`,
                        width: `${(red.box.xmax - red.box.xmin) / 10}%`,
                      }}
                    >
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-indigo-600/80 text-white text-[10px] flex items-center justify-center pointer-events-none transition-all overflow-hidden p-1">
                        <span className="truncate">{red.category}</span>
                      </div>
                      {/* Interaction delete */}
                      <button 
                        onClick={() => deleteRedaction(red.id)}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-all z-10"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                  
                {/* Page Number Badge */}
                <div className="absolute top-4 right-4 bg-slate-800/20 backdrop-blur-md px-2 py-1 rounded text-[10px] font-bold text-slate-800">
                  STRONA {page.pageNumber}
                </div>
              </div>
            ))}
          </div>

          {/* Floating Action Badge */}
          {redactions.length > 0 && (
            <div className="fixed bottom-8 right-8 flex gap-3">
              <div className="bg-white/80 backdrop-blur-md px-4 py-2 rounded-full border border-slate-200 shadow-xl flex items-center gap-2">
                <CheckCircle2 className="text-green-500" size={16} />
                <span className="text-xs font-bold text-slate-700">Aktywnych pól: {redactions.length}</span>
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="bg-white border-t border-slate-200 px-6 py-2 text-[10px] text-slate-400 flex justify-between items-center">
        <div>Zasilane przez Gemini AI & jsPDF</div>
        <div>Wszystkie dane są przetwarzane zgodnie z polityką prywatności API.</div>
      </footer>
    </div>
  );
}
