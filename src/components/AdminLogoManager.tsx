import React, { useState, useRef } from 'react';
import { EventSettings, Language } from '../types/index';
import { sanitizeAndValidateSvg } from '../utils/svgSecurity';
import { updateOfficialLogo, removeOfficialLogo } from '../firebase/services';
import { User } from 'firebase/auth';
import {
  Upload,
  Image as ImageIcon,
  CheckCircle,
  AlertTriangle,
  Trash2,
  RefreshCw,
  Eye,
  ShieldCheck,
  FileCheck,
} from 'lucide-react';

interface AdminLogoManagerProps {
  settings: EventSettings;
  lang: Language;
  currentUser?: User | null;
  onSettingsUpdated: (updated: EventSettings) => void;
}

export const AdminLogoManager: React.FC<AdminLogoManagerProps> = ({
  settings,
  lang,
  currentUser,
  onSettingsUpdated,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Staged logo for preview before saving
  const [previewDataUri, setPreviewDataUri] = useState<string | null>(null);
  const [previewRawSvg, setPreviewRawSvg] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [fileSizeKb, setFileSizeKb] = useState<number | null>(null);

  // UI status
  const [isUploading, setIsUploading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Open mobile file picker
  const handleTriggerFileInput = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  // Handle selected SVG file
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFileName(file.name);
    setFileSizeKb(Math.round(file.size / 1024));
    setErrorMessage(null);
    setSuccessMessage(null);

    // Read file text
    const reader = new FileReader();
    reader.onload = (event) => {
      const rawContent = event.target?.result;
      if (typeof rawContent !== 'string') {
        setErrorMessage(
          lang === 'fr'
            ? 'Impossible de lire le fichier sélectionné.'
            : 'Could not read the selected file.'
        );
        return;
      }

      // Security validation and sanitization
      const validation = sanitizeAndValidateSvg(rawContent, file.size);

      if (!validation.isValid) {
        if (validation.error === 'FILE_TOO_LARGE') {
          setErrorMessage(
            lang === 'fr'
              ? 'Le fichier est trop volumineux. La taille maximale autorisée est de 2 Mo.'
              : 'File is too large. Maximum allowed size is 2MB.'
          );
        } else if (validation.error === 'ACTIVE_CODE_OR_DANGEROUS_ELEMENTS_DETECTED') {
          setErrorMessage(
            lang === 'fr'
              ? 'Sécurité : Le fichier SVG a été rejeté car il contient des scripts ou des éléments actifs non autorisés.'
              : 'Security: SVG rejected because it contains unauthorized active scripts or code.'
          );
        } else {
          setErrorMessage(
            lang === 'fr'
              ? 'Le fichier sélectionné n\'est pas un SVG valide.'
              : 'The selected file is not a valid SVG.'
          );
        }
        setPreviewDataUri(null);
        setPreviewRawSvg(null);
        return;
      }

      // Staged clean preview
      setPreviewDataUri(validation.dataUri || null);
      setPreviewRawSvg(validation.sanitizedSvg || null);
    };

    reader.onerror = () => {
      setErrorMessage(
        lang === 'fr'
          ? 'Erreur lors de la lecture du fichier.'
          : 'Error reading file.'
      );
    };

    reader.readAsText(file);
  };

  // Save the staged logo to persistent storage & Firestore
  const handleSaveLogo = async () => {
    if (!previewDataUri) return;
    setIsUploading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const finalUrl = await updateOfficialLogo(previewDataUri, previewRawSvg || undefined, currentUser);

      const updatedSettings: EventSettings = {
        ...settings,
        logoUrl: finalUrl,
        logoUpdatedAt: new Date().toISOString(),
      };

      onSettingsUpdated(updatedSettings);

      setSuccessMessage(
        lang === 'fr'
          ? 'Logo officiel enregistré avec succès ! Il est désormais affiché sur la page d\'accueil.'
          : 'Official logo saved successfully! It is now displayed on the homepage.'
      );

      // Reset staging
      setPreviewDataUri(null);
      setPreviewRawSvg(null);
      setSelectedFileName(null);
    } catch (err: any) {
      console.error('Error uploading logo:', err);
      setErrorMessage(
        err.message === 'NOT_AUTHORIZED'
          ? 'Action non autorisée. Votre compte administrateur doit être vérifié.'
          : 'Erreur lors de l\'enregistrement du logo dans Firebase.'
      );
    } finally {
      setIsUploading(false);
    }
  };

  // Remove logo
  const handleRemoveLogo = async () => {
    if (!settings.logoUrl) return;
    if (
      !window.confirm(
        lang === 'fr'
          ? 'Êtes-vous sûr de vouloir supprimer le logo officiel ? Le titre temporaire sera réaffiché.'
          : 'Are you sure you want to remove the official logo?'
      )
    ) {
      return;
    }

    setIsUploading(true);
    try {
      await removeOfficialLogo(currentUser);
      onSettingsUpdated({
        ...settings,
        logoUrl: '',
        logoUpdatedAt: new Date().toISOString(),
      });
      setSuccessMessage(
        lang === 'fr'
          ? 'Logo officiel retiré. La page d\'accueil utilise le titre temporaire.'
          : 'Official logo removed.'
      );
    } catch (err: any) {
      console.error('Error removing logo:', err);
      setErrorMessage('Erreur lors de la suppression du logo.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border-2 border-[#111111] p-5 sm:p-7 shadow-[4px_4px_0_0_#111111] max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="border-b-2 border-gray-100 pb-3">
        <div className="flex items-center gap-2 text-[#FF6A00] font-black text-xs uppercase mb-1">
          <ImageIcon className="w-4 h-4" />
          <span>Paramètres • Identité Visuelle</span>
        </div>
        <h2 className="text-xl font-black text-[#111111] uppercase font-['Space_Grotesk']">
          Logo Officiel GLORIOUS YOUTH 2027
        </h2>
        <p className="text-xs text-gray-600 mt-1 font-medium">
          Importez le logo officiel au format SVG transparent. Il remplacera automatiquement le titre textuel sur la page d'accueil pour tous les visiteurs.
        </p>
      </div>

      {/* Hidden Mobile-compatible file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".svg,image/svg+xml"
        className="hidden"
      />

      {/* Success Notification */}
      {successMessage && (
        <div className="p-3.5 rounded-xl bg-green-50 border-2 border-green-500 text-xs font-bold text-green-900 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Error Notification */}
      {errorMessage && (
        <div className="p-3.5 rounded-xl bg-red-50 border-2 border-[#F0443E] text-xs font-bold text-red-900 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-[#F0443E] shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* 1. Current Active Logo Section */}
      <div className="p-4 rounded-xl border-2 border-[#111111] bg-[#FFF3DD]/40 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-black uppercase text-[#111111] flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5 text-[#2457FF]" />
            Logo Actuellement en Ligne
          </span>
          {settings.logoUrl && (
            <span className="text-[10px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full border border-green-300">
              Actif sur l'accueil
            </span>
          )}
        </div>

        {/* Display Current Logo Container */}
        {settings.logoUrl ? (
          <div className="space-y-3">
            {/* Transparent checkerboard preview box to verify transparency */}
            <div
              className="p-6 rounded-xl border-2 border-[#111111] flex items-center justify-center min-h-[160px] overflow-hidden"
              style={{
                backgroundColor: '#FFF3DD',
                backgroundImage:
                  'linear-gradient(45deg, #f7e6c9 25%, transparent 25%), linear-gradient(-45deg, #f7e6c9 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f7e6c9 75%), linear-gradient(-45deg, transparent 75%, #f7e6c9 75%)',
                backgroundSize: '16px 16px',
                backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
              }}
            >
              <img
                src={settings.logoUrl}
                alt="Logo officiel en ligne"
                className="max-h-36 w-auto max-w-full object-contain"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-gray-500 font-medium">
                {settings.logoUpdatedAt
                  ? `Mis à jour le ${new Date(settings.logoUpdatedAt).toLocaleString('fr-FR')}`
                  : 'Logo enregistré'}
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTriggerFileInput}
                  disabled={isUploading}
                  className="inline-flex items-center gap-1.5 bg-[#FF6A00] hover:bg-[#e05e00] text-white font-bold text-xs px-3 py-1.5 rounded-lg border-2 border-[#111111] shadow-[2px_2px_0_0_#111111] cursor-pointer active:translate-x-0.5 active:translate-y-0.5 transition-all"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Remplacer le logo</span>
                </button>

                <button
                  type="button"
                  onClick={handleRemoveLogo}
                  disabled={isUploading}
                  className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg border border-red-300 cursor-pointer"
                  title="Supprimer le logo"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6 rounded-xl border-2 border-dashed border-gray-400 bg-white/70 text-center space-y-3">
            <div className="w-12 h-12 mx-auto rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
              <ImageIcon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-bold text-gray-700">Aucun logo officiel enregistré</p>
              <p className="text-[11px] text-gray-500 mt-0.5">
                La page d'accueil affiche actuellement le titre textuel temporaire de secours.
              </p>
            </div>
            <button
              type="button"
              onClick={handleTriggerFileInput}
              disabled={isUploading}
              className="inline-flex items-center gap-2 bg-[#FF6A00] hover:bg-[#e05e00] text-white font-extrabold text-xs px-4 py-2 rounded-xl border-2 border-[#111111] shadow-[2px_2px_0_0_#111111] cursor-pointer active:translate-x-0.5 active:translate-y-0.5 transition-all"
            >
              <Upload className="w-4 h-4" />
              <span>Importer un logo SVG</span>
            </button>
          </div>
        )}
      </div>

      {/* 2. New Logo Staged Preview (Before Final Confirmation) */}
      {previewDataUri && (
        <div className="p-4 rounded-xl border-3 border-[#2457FF] bg-blue-50/50 space-y-3 animate-in fade-in">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase text-[#2457FF] flex items-center gap-1.5">
              <FileCheck className="w-4 h-4" />
              Aperçu avant enregistrement
            </span>
            <span className="text-[10px] font-bold text-gray-600 bg-white px-2 py-0.5 rounded border border-gray-300">
              {selectedFileName} ({fileSizeKb} Ko)
            </span>
          </div>

          {/* Preview canvas */}
          <div
            className="p-6 rounded-xl border-2 border-[#111111] flex items-center justify-center min-h-[160px] overflow-hidden"
            style={{
              backgroundColor: '#FFF3DD',
              backgroundImage:
                'linear-gradient(45deg, #f7e6c9 25%, transparent 25%), linear-gradient(-45deg, #f7e6c9 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f7e6c9 75%), linear-gradient(-45deg, transparent 75%, #f7e6c9 75%)',
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
            }}
          >
            <img
              src={previewDataUri}
              alt="Aperçu nouveau logo"
              className="max-h-40 w-auto max-w-full object-contain"
            />
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-green-700 font-bold">
            <ShieldCheck className="w-4 h-4" />
            <span>Fichier SVG assaini et validé avec succès (aucun code actif dangereux).</span>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <button
              type="button"
              onClick={handleSaveLogo}
              disabled={isUploading}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-[#2457FF] hover:bg-[#1a44d1] text-white font-black text-xs sm:text-sm py-3 px-4 rounded-xl border-2 border-[#111111] shadow-[3px_3px_0_0_#111111] cursor-pointer active:translate-x-0.5 active:translate-y-0.5 disabled:opacity-50 transition-all"
            >
              <CheckCircle className="w-4 h-4" />
              <span>{isUploading ? 'Enregistrement en cours...' : 'Enregistrer les modifications'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setPreviewDataUri(null);
                setPreviewRawSvg(null);
                setSelectedFileName(null);
              }}
              disabled={isUploading}
              className="px-4 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold text-xs rounded-xl border border-gray-400 cursor-pointer"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Security notice for admins */}
      <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-[11px] text-gray-600 space-y-1">
        <div className="font-extrabold text-[#111111] uppercase flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-[#5B2EFF]" />
          <span>Normes de sécurité SVG appliquées</span>
        </div>
        <p className="leading-relaxed">
          Chaque fichier SVG importé est soumis à une inspection rigoureuse : vérification du format, limite stricte de 2 Mo, assainissement complet avec DOMPurify et élimination systématique de tout script, événement JavaScript ou ressource externe.
        </p>
      </div>
    </div>
  );
};
