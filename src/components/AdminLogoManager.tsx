import React, { useState, useRef } from 'react';
import { EventSettings, Language } from '../types/index';
import { sanitizeAndValidateSvg } from '../utils/svgSecurity';
import {
  updateOfficialLogo,
  removeOfficialLogo,
  updateHeaderLogo,
  removeHeaderLogo,
  useMainLogoAsHeaderLogo,
} from '../firebase/services';
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
  Copy,
  Compass,
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
  // Active sub-tab between Main Logo and Header Logo
  const [activeSection, setActiveSection] = useState<'main' | 'header'>('main');

  // Main logo file input ref & staging state
  const mainFileInputRef = useRef<HTMLInputElement>(null);
  const [mainPreviewUri, setMainPreviewUri] = useState<string | null>(null);
  const [mainRawSvg, setMainRawSvg] = useState<string | null>(null);
  const [mainFileName, setMainFileName] = useState<string | null>(null);
  const [mainFileSizeKb, setMainFileSizeKb] = useState<number | null>(null);
  const [mainFormatLabel, setMainFormatLabel] = useState<string>('SVG');

  // Header logo file input ref & staging state
  const headerFileInputRef = useRef<HTMLInputElement>(null);
  const [headerPreviewUri, setHeaderPreviewUri] = useState<string | null>(null);
  const [headerRawSvg, setHeaderRawSvg] = useState<string | null>(null);
  const [headerFileName, setHeaderFileName] = useState<string | null>(null);
  const [headerFileSizeKb, setHeaderFileSizeKb] = useState<number | null>(null);
  const [headerFormatLabel, setHeaderFormatLabel] = useState<string>('SVG');

  // Inline delete confirmation states (eliminates window.confirm blocked by iframes)
  const [confirmDeleteMain, setConfirmDeleteMain] = useState(false);
  const [confirmDeleteHeader, setConfirmDeleteHeader] = useState(false);

  // Status
  const [isUploading, setIsUploading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Universal image processor supporting SVG, PNG, JPG/JPEG and WebP
  const processLogoFile = (
    file: File,
    onSuccess: (dataUri: string, rawSvg: string, name: string, sizeKb: number, formatLabel: string) => void
  ) => {
    setErrorMessage(null);
    setSuccessMessage(null);

    const sizeKb = Math.round(file.size / 1024);
    if (file.size > 2 * 1024 * 1024) {
      setErrorMessage(
        lang === 'fr'
          ? 'Le fichier est trop volumineux. La taille maximale autorisée est de 2 Mo.'
          : 'File is too large. Maximum allowed size is 2MB.'
      );
      return;
    }

    const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
    const isRasterImage =
      file.type.startsWith('image/png') ||
      file.type.startsWith('image/jpeg') ||
      file.type.startsWith('image/webp') ||
      /\.(png|jpe?g|webp)$/i.test(file.name);

    if (isSvg) {
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
                ? 'Le fichier sélectionné n\'est pas un format SVG valide.'
                : 'The selected file is not a valid SVG.'
            );
          }
          return;
        }

        onSuccess(validation.dataUri || '', validation.sanitizedSvg || rawContent, file.name, sizeKb, 'SVG Assaini');
      };

      reader.onerror = () => {
        setErrorMessage(
          lang === 'fr' ? 'Erreur lors de la lecture du fichier.' : 'Error reading file.'
        );
      };

      reader.readAsText(file);
    } else if (isRasterImage) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUri = event.target?.result;
        if (typeof dataUri !== 'string') {
          setErrorMessage(
            lang === 'fr'
              ? 'Impossible de lire l\'image sélectionnée.'
              : 'Could not read the selected image.'
          );
          return;
        }

        const ext = file.name.split('.').pop()?.toUpperCase() || 'IMAGE';
        const img = new Image();
        img.onload = () => {
          onSuccess(dataUri, '', file.name, sizeKb, `${ext} (${img.naturalWidth}×${img.naturalHeight}px)`);
        };
        img.onerror = () => {
          setErrorMessage(
            lang === 'fr'
              ? 'Format d\'image corrompu ou illisible.'
              : 'Corrupted or unreadable image format.'
          );
        };
        img.src = dataUri;
      };

      reader.onerror = () => {
        setErrorMessage(
          lang === 'fr' ? 'Erreur lors de la lecture de l\'image.' : 'Error reading image.'
        );
      };

      reader.readAsDataURL(file);
    } else {
      setErrorMessage(
        lang === 'fr'
          ? 'Format non pris en charge. Veuillez importer un fichier SVG, PNG, JPG ou WebP (max 2 Mo).'
          : 'Unsupported format. Please upload an SVG, PNG, JPG, or WebP file (max 2MB).'
      );
    }
  };

  // Main logo file change
  const handleMainFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processLogoFile(file, (dataUri, rawSvg, name, sizeKb, formatLabel) => {
      setMainPreviewUri(dataUri);
      setMainRawSvg(rawSvg);
      setMainFileName(name);
      setMainFileSizeKb(sizeKb);
      setMainFormatLabel(formatLabel);
      setConfirmDeleteMain(false);
    });
    e.target.value = '';
  };

  // Header logo file change
  const handleHeaderFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processLogoFile(file, (dataUri, rawSvg, name, sizeKb, formatLabel) => {
      setHeaderPreviewUri(dataUri);
      setHeaderRawSvg(rawSvg);
      setHeaderFileName(name);
      setHeaderFileSizeKb(sizeKb);
      setHeaderFormatLabel(formatLabel);
      setConfirmDeleteHeader(false);
    });
    e.target.value = '';
  };

  // Active resolved logos (checking direct URL or chunked localStorage hydration)
  const activeMainLogo =
    settings.logoUrl ||
    (settings.logoAsset?.assetId && typeof window !== 'undefined'
      ? localStorage.getItem(`gyw_asset_${settings.logoAsset.assetId}`) || ''
      : '') ||
    '';
  const hasActiveMainLogo = Boolean(activeMainLogo || settings.logoAsset?.assetId);

  const activeHeaderLogo =
    settings.headerLogoUrl ||
    (settings.headerLogoAsset?.assetId && typeof window !== 'undefined'
      ? localStorage.getItem(`gyw_asset_${settings.headerLogoAsset.assetId}`) || ''
      : '') ||
    '';
  const hasActiveHeaderLogo = Boolean(activeHeaderLogo || settings.headerLogoAsset?.assetId);

  // 1. Save Main Logo
  const handleSaveMainLogo = async () => {
    if (!mainPreviewUri) return;
    setIsUploading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const updatedSettings = await updateOfficialLogo(mainPreviewUri, mainRawSvg || undefined, currentUser);
      onSettingsUpdated(updatedSettings);

      setSuccessMessage(
        lang === 'fr'
          ? 'Logo principal enregistré avec succès ! Il est désormais actif sur la page d\'accueil.'
          : 'Main logo saved successfully! It is now active on the homepage.'
      );
      setMainPreviewUri(null);
      setMainRawSvg(null);
      setMainFileName(null);
    } catch (err: any) {
      console.error('Error saving main logo:', err);
      setErrorMessage(
        err.message === 'NOT_AUTHORIZED'
          ? 'Action non autorisée. Votre compte administrateur doit être vérifié.'
          : `Erreur lors de l'enregistrement du logo principal : ${err?.message || 'Erreur réseau ou base de données.'}`
      );
    } finally {
      setIsUploading(false);
    }
  };

  // 2. Remove Main Logo (using inline confirmation, immune to iframe window.confirm blocking)
  const handleRemoveMainLogo = async () => {
    if (!hasActiveMainLogo) return;
    setIsUploading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const updatedSettings = await removeOfficialLogo(currentUser);
      onSettingsUpdated(updatedSettings);
      setConfirmDeleteMain(false);
      setSuccessMessage(
        lang === 'fr'
          ? 'Logo principal retiré avec succès. La page d\'accueil affiche le titre officiel de secours.'
          : 'Main logo removed successfully.'
      );
    } catch (err: any) {
      console.error('Error removing main logo:', err);
      setErrorMessage(
        lang === 'fr'
          ? `Erreur lors de la suppression du logo principal : ${err?.message || 'Erreur inconnue.'}`
          : `Error removing main logo: ${err?.message || 'Unknown error.'}`
      );
    } finally {
      setIsUploading(false);
    }
  };

  // 3. Save Header Logo
  const handleSaveHeaderLogo = async () => {
    if (!headerPreviewUri) return;
    setIsUploading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const updatedSettings = await updateHeaderLogo(headerPreviewUri, headerRawSvg || undefined, currentUser);
      onSettingsUpdated(updatedSettings);

      setSuccessMessage(
        lang === 'fr'
          ? 'Logo du header enregistré avec succès ! Il est désormais affiché dans la barre de navigation.'
          : 'Header logo saved successfully! It is now displayed in the navigation bar.'
      );
      setHeaderPreviewUri(null);
      setHeaderRawSvg(null);
      setHeaderFileName(null);
    } catch (err: any) {
      console.error('Error saving header logo:', err);
      setErrorMessage(
        err.message === 'NOT_AUTHORIZED'
          ? 'Action non autorisée. Votre compte administrateur doit être vérifié.'
          : `Erreur lors de l'enregistrement du logo du header : ${err?.message || 'Erreur réseau ou base de données.'}`
      );
    } finally {
      setIsUploading(false);
    }
  };

  // 4. Remove Header Logo (using inline confirmation, immune to iframe window.confirm blocking)
  const handleRemoveHeaderLogo = async () => {
    if (!hasActiveHeaderLogo) return;
    setIsUploading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const updatedSettings = await removeHeaderLogo(currentUser);
      onSettingsUpdated(updatedSettings);
      setConfirmDeleteHeader(false);
      setSuccessMessage(
        lang === 'fr'
          ? 'Logo du header retiré avec succès. Le badge officiel GYW par défaut est réactivé.'
          : 'Header logo removed successfully. Default GYW badge restored.'
      );
    } catch (err: any) {
      console.error('Error removing header logo:', err);
      setErrorMessage(
        lang === 'fr'
          ? `Erreur lors de la suppression du logo du header : ${err?.message || 'Erreur inconnue.'}`
          : `Error removing header logo: ${err?.message || 'Unknown error.'}`
      );
    } finally {
      setIsUploading(false);
    }
  };

  // 5. Clone Main Logo to Header Logo
  const handleCopyMainToHeader = async () => {
    if (!hasActiveMainLogo) {
      setErrorMessage(
        lang === 'fr'
          ? 'Aucun logo principal n\'est actuellement enregistré à copier.'
          : 'No main logo currently registered to copy.'
      );
      return;
    }

    setIsUploading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const updatedSettings = await useMainLogoAsHeaderLogo(currentUser);
      onSettingsUpdated(updatedSettings);
      setSuccessMessage(
        lang === 'fr'
          ? 'Le logo principal a été copié et configuré pour le header avec succès !'
          : 'Main logo successfully copied and applied to the header!'
      );
    } catch (err: any) {
      console.error('Error cloning main logo:', err);
      setErrorMessage('Erreur lors de la copie du logo principal vers le header.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border-2 border-[#111111] p-5 sm:p-7 shadow-[4px_4px_0_0_#111111] max-w-3xl mx-auto space-y-6">
      {/* Title & Description */}
      <div className="border-b-2 border-gray-100 pb-4">
        <div className="flex items-center gap-2 text-[#FF6A00] font-black text-xs uppercase mb-1">
          <ImageIcon className="w-4 h-4" />
          <span>Paramètres • Identité Visuelle</span>
        </div>
        <h2 className="text-xl sm:text-2xl font-black text-[#111111] uppercase font-['Space_Grotesk']">
          Gestion des Logos Officiels
        </h2>
        <p className="text-xs sm:text-sm text-gray-600 mt-1 font-medium leading-relaxed">
          Configurez indépendamment le logo principal de la page d'accueil et le logo de la barre de navigation. Formats acceptés : SVG, PNG transparent, JPG ou WebP (max 2 Mo). Les fichiers sont vérifiés, assainis et protégés.
        </p>
      </div>

      {/* Sub-tab Switcher: Logo Principal vs Logo Header */}
      <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-xl border-2 border-[#111111]">
        <button
          type="button"
          onClick={() => setActiveSection('main')}
          className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg font-black text-xs uppercase cursor-pointer transition-all ${
            activeSection === 'main'
              ? 'bg-[#FF6A00] text-white shadow-[2px_2px_0_0_#111111]'
              : 'text-[#111111] hover:bg-gray-200'
          }`}
        >
          <ImageIcon className="w-4 h-4" />
          <span>Logo Principal (Accueil)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection('header')}
          className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg font-black text-xs uppercase cursor-pointer transition-all ${
            activeSection === 'header'
              ? 'bg-[#2457FF] text-white shadow-[2px_2px_0_0_#111111]'
              : 'text-[#111111] hover:bg-gray-200'
          }`}
        >
          <Compass className="w-4 h-4" />
          <span>Logo du Header (Navigation)</span>
        </button>
      </div>

      {/* Hidden file inputs */}
      <input
        type="file"
        ref={mainFileInputRef}
        onChange={handleMainFileChange}
        accept="image/svg+xml,.svg,image/png,.png,image/jpeg,.jpg,.jpeg,image/webp,.webp"
        className="hidden"
      />
      <input
        type="file"
        ref={headerFileInputRef}
        onChange={handleHeaderFileChange}
        accept="image/svg+xml,.svg,image/png,.png,image/jpeg,.jpg,.jpeg,image/webp,.webp"
        className="hidden"
      />

      {/* Success Notification */}
      {successMessage && (
        <div className="p-3.5 rounded-xl bg-green-50 border-2 border-green-500 text-xs font-bold text-green-900 flex items-center gap-2.5 animate-in fade-in">
          <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Error Notification */}
      {errorMessage && (
        <div className="p-3.5 rounded-xl bg-red-50 border-2 border-[#F0443E] text-xs font-bold text-red-900 flex items-start gap-2.5 animate-in fade-in">
          <AlertTriangle className="w-5 h-5 text-[#F0443E] shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* ============================================================= */}
      {/* SECTION A: LOGO PRINCIPAL (Hero / Accueil)                    */}
      {/* ============================================================= */}
      {activeSection === 'main' && (
        <div className="space-y-5 animate-in fade-in">
          {/* Active online logo display */}
          <div className="p-5 rounded-2xl border-2 border-[#111111] bg-[#FFF3DD]/40 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase text-[#111111] flex items-center gap-1.5">
                <Eye className="w-4 h-4 text-[#FF6A00]" />
                Logo Principal Actuellement en Ligne
              </span>
              {hasActiveMainLogo && (
                <span className="text-[10px] font-black text-green-800 bg-green-100 px-2.5 py-0.5 rounded-full border border-green-300">
                  Actif sur la page d'accueil
                </span>
              )}
            </div>

            {hasActiveMainLogo ? (
              <div className="space-y-3">
                {/* Checkerboard transparency preview container */}
                <div
                  className="p-6 rounded-xl border-2 border-[#111111] flex items-center justify-center min-h-[180px] overflow-hidden"
                  style={{
                    backgroundColor: '#FFF3DD',
                    backgroundImage:
                      'linear-gradient(45deg, #f7e6c9 25%, transparent 25%), linear-gradient(-45deg, #f7e6c9 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f7e6c9 75%), linear-gradient(-45deg, transparent 75%, #f7e6c9 75%)',
                    backgroundSize: '16px 16px',
                    backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                  }}
                >
                  <img
                    src={activeMainLogo}
                    alt="Logo principal actif"
                    className="max-h-44 w-auto max-w-full object-contain"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] text-gray-500 font-semibold">
                    {settings.logoUpdatedAt
                      ? `Mis à jour le ${new Date(settings.logoUpdatedAt).toLocaleString('fr-FR')}`
                      : 'Logo enregistré'}
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMessage(null);
                        setSuccessMessage(null);
                        mainFileInputRef.current?.click();
                      }}
                      disabled={isUploading}
                      className="inline-flex items-center gap-1.5 bg-[#FF6A00] hover:bg-[#e05e00] text-white font-bold text-xs px-3.5 py-2 rounded-xl border-2 border-[#111111] shadow-[2px_2px_0_0_#111111] cursor-pointer active:translate-x-0.5 active:translate-y-0.5 transition-all"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Remplacer le logo</span>
                    </button>

                    {confirmDeleteMain ? (
                      <div className="flex items-center gap-1.5 bg-red-50 p-1.5 rounded-xl border-2 border-red-400 animate-in fade-in">
                        <span className="text-[11px] font-bold text-red-900 hidden sm:inline">
                          Confirmer la suppression ?
                        </span>
                        <button
                          type="button"
                          onClick={handleRemoveMainLogo}
                          disabled={isUploading}
                          className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white font-black text-xs rounded-lg cursor-pointer transition-colors shadow-sm"
                        >
                          {isUploading ? '...' : 'Supprimer'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteMain(false)}
                          disabled={isUploading}
                          className="px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold text-xs rounded-lg cursor-pointer"
                        >
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setErrorMessage(null);
                          setConfirmDeleteMain(true);
                        }}
                        disabled={isUploading}
                        className="inline-flex items-center gap-1.5 p-2 px-3 text-red-600 hover:bg-red-50 rounded-xl border-2 border-red-300 hover:border-red-500 cursor-pointer transition-colors"
                        title="Supprimer le logo principal"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span className="text-xs font-bold">Supprimer</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-8 rounded-xl border-2 border-dashed border-gray-400 bg-white/70 text-center space-y-3">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-orange-50 border-2 border-[#111111] flex items-center justify-center text-[#FF6A00]">
                  <ImageIcon className="w-7 h-7" />
                </div>
                <div>
                  <p className="text-sm font-extrabold text-[#111111]">Aucun logo principal enregistré</p>
                  <p className="text-xs text-gray-600 mt-1 max-w-sm mx-auto">
                    La page d'accueil affiche actuellement le titre typographique de secours.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage(null);
                    setSuccessMessage(null);
                    mainFileInputRef.current?.click();
                  }}
                  disabled={isUploading}
                  className="inline-flex items-center gap-2 bg-[#FF6A00] hover:bg-[#e05e00] text-white font-black text-xs sm:text-sm px-5 py-2.5 rounded-xl border-2 border-[#111111] shadow-[3px_3px_0_0_#111111] cursor-pointer active:translate-x-0.5 active:translate-y-0.5 transition-all"
                >
                  <Upload className="w-4 h-4" />
                  <span>Importer un logo (SVG, PNG, JPG, WebP)</span>
                </button>
              </div>
            )}
          </div>

          {/* Staged preview before saving */}
          {mainPreviewUri && (
            <div className="p-5 rounded-2xl border-3 border-[#FF6A00] bg-orange-50/40 space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-[#FF6A00] flex items-center gap-1.5">
                  <FileCheck className="w-4 h-4" />
                  Aperçu avant enregistrement
                </span>
                <span className="text-[10px] font-bold text-gray-700 bg-white px-2 py-0.5 rounded border border-gray-300">
                  {mainFileName} ({mainFileSizeKb} Ko)
                </span>
              </div>

              <div
                className="p-6 rounded-xl border-2 border-[#111111] flex items-center justify-center min-h-[180px] overflow-hidden"
                style={{
                  backgroundColor: '#FFF3DD',
                  backgroundImage:
                    'linear-gradient(45deg, #f7e6c9 25%, transparent 25%), linear-gradient(-45deg, #f7e6c9 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f7e6c9 75%), linear-gradient(-45deg, transparent 75%, #f7e6c9 75%)',
                  backgroundSize: '16px 16px',
                  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                }}
              >
                <img
                  src={mainPreviewUri}
                  alt="Aperçu nouveau logo principal"
                  className="max-h-44 w-auto max-w-full object-contain"
                />
              </div>

              <div className="flex items-center gap-1.5 text-xs text-green-700 font-bold">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Format {mainFormatLabel} vérifié • Zéro script malveillant.</span>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleSaveMainLogo}
                  disabled={isUploading}
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-[#FF6A00] hover:bg-[#e05e00] text-white font-black text-xs sm:text-sm py-3 px-4 rounded-xl border-2 border-[#111111] shadow-[3px_3px_0_0_#111111] cursor-pointer active:translate-x-0.5 active:translate-y-0.5 disabled:opacity-50 transition-all"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>{isUploading ? 'Enregistrement en cours...' : 'Enregistrer le logo principal'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMainPreviewUri(null);
                    setMainRawSvg(null);
                    setMainFileName(null);
                  }}
                  disabled={isUploading}
                  className="px-4 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold text-xs rounded-xl border border-gray-400 cursor-pointer"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================= */}
      {/* SECTION B: LOGO DU HEADER (Barre de navigation)               */}
      {/* ============================================================= */}
      {activeSection === 'header' && (
        <div className="space-y-5 animate-in fade-in">
          {/* Active online header logo display */}
          <div className="p-5 rounded-2xl border-2 border-[#111111] bg-[#FFF3DD]/40 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase text-[#111111] flex items-center gap-1.5">
                <Eye className="w-4 h-4 text-[#2457FF]" />
                Logo du Header Actuellement en Ligne
              </span>
              {hasActiveHeaderLogo ? (
                <span className="text-[10px] font-black text-blue-800 bg-blue-100 px-2.5 py-0.5 rounded-full border border-blue-300">
                  Logo personnalisé actif
                </span>
              ) : (
                <span className="text-[10px] font-bold text-gray-700 bg-gray-200 px-2.5 py-0.5 rounded-full">
                  Badge GYW par défaut
                </span>
              )}
            </div>

            {hasActiveHeaderLogo ? (
              <div className="space-y-3">
                {/* Live simulation within header navbar */}
                <div className="p-4 rounded-xl border-2 border-[#111111] bg-[#FFF3DD] space-y-1">
                  <div className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-2">
                    Simulation en direct dans la barre de navigation :
                  </div>
                  <div className="flex items-center gap-2.5 py-2 px-3 rounded-lg border border-[#111111]/20 bg-white/50">
                    <img
                      src={activeHeaderLogo}
                      alt="Logo header actif"
                      className="h-10 w-auto max-w-[150px] object-contain"
                    />
                    <div className="flex flex-col">
                      <span className="font-extrabold text-[#111111] text-xs sm:text-sm uppercase font-['Space_Grotesk']">
                        Glorious Youth
                      </span>
                      <span className="text-[9px] font-bold text-[#FF6A00] uppercase">
                        6th Edition • 2027
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] text-gray-500 font-semibold">
                    {settings.headerLogoUpdatedAt
                      ? `Mis à jour le ${new Date(settings.headerLogoUpdatedAt).toLocaleString('fr-FR')}`
                      : 'Logo de header enregistré'}
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMessage(null);
                        setSuccessMessage(null);
                        headerFileInputRef.current?.click();
                      }}
                      disabled={isUploading}
                      className="inline-flex items-center gap-1.5 bg-[#2457FF] hover:bg-[#1a44d1] text-white font-bold text-xs px-3.5 py-2 rounded-xl border-2 border-[#111111] shadow-[2px_2px_0_0_#111111] cursor-pointer active:translate-x-0.5 active:translate-y-0.5 transition-all"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Remplacer le logo</span>
                    </button>

                    {confirmDeleteHeader ? (
                      <div className="flex items-center gap-1.5 bg-red-50 p-1.5 rounded-xl border-2 border-red-400 animate-in fade-in">
                        <span className="text-[11px] font-bold text-red-900 hidden sm:inline">
                          Confirmer la suppression ?
                        </span>
                        <button
                          type="button"
                          onClick={handleRemoveHeaderLogo}
                          disabled={isUploading}
                          className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white font-black text-xs rounded-lg cursor-pointer transition-colors shadow-sm"
                        >
                          {isUploading ? '...' : 'Supprimer'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteHeader(false)}
                          disabled={isUploading}
                          className="px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold text-xs rounded-lg cursor-pointer"
                        >
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setErrorMessage(null);
                          setConfirmDeleteHeader(true);
                        }}
                        disabled={isUploading}
                        className="inline-flex items-center gap-1.5 p-2 px-3 text-red-600 hover:bg-red-50 rounded-xl border-2 border-red-300 hover:border-red-500 cursor-pointer transition-colors"
                        title="Supprimer le logo du header (restaurer le badge par défaut)"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span className="text-xs font-bold">Supprimer</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-8 rounded-xl border-2 border-dashed border-gray-400 bg-white/70 text-center space-y-4">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-blue-50 border-2 border-[#111111] flex items-center justify-center text-[#2457FF]">
                  <Compass className="w-7 h-7" />
                </div>
                <div>
                  <p className="text-sm font-extrabold text-[#111111]">Aucun logo spécifique configuré pour le header</p>
                  <p className="text-xs text-gray-600 mt-1 max-w-sm mx-auto">
                    Le header affiche actuellement le badge géométrique par défaut « GYW ».
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMessage(null);
                      setSuccessMessage(null);
                      headerFileInputRef.current?.click();
                    }}
                    disabled={isUploading}
                    className="inline-flex items-center gap-2 bg-[#2457FF] hover:bg-[#1a44d1] text-white font-black text-xs sm:text-sm px-4 py-2.5 rounded-xl border-2 border-[#111111] shadow-[3px_3px_0_0_#111111] cursor-pointer active:translate-x-0.5 active:translate-y-0.5 transition-all"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Importer un logo (SVG, PNG, JPG, WebP)</span>
                  </button>

                  {/* Option to clone main logo */}
                  {hasActiveMainLogo && (
                    <button
                      type="button"
                      onClick={handleCopyMainToHeader}
                      disabled={isUploading}
                      className="inline-flex items-center gap-2 bg-white hover:bg-gray-100 text-[#111111] font-black text-xs sm:text-sm px-4 py-2.5 rounded-xl border-2 border-[#111111] shadow-[2px_2px_0_0_#111111] cursor-pointer active:translate-x-0.5 active:translate-y-0.5 transition-all"
                      title="Utiliser automatiquement le même logo que la page d'accueil"
                    >
                      <Copy className="w-4 h-4 text-[#FF6A00]" />
                      <span>Utiliser le logo principal</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Staged header logo preview */}
          {headerPreviewUri && (
            <div className="p-5 rounded-2xl border-3 border-[#2457FF] bg-blue-50/40 space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-[#2457FF] flex items-center gap-1.5">
                  <FileCheck className="w-4 h-4" />
                  Aperçu du logo de header avant enregistrement
                </span>
                <span className="text-[10px] font-bold text-gray-700 bg-white px-2 py-0.5 rounded border border-gray-300">
                  {headerFileName} ({headerFileSizeKb} Ko)
                </span>
              </div>

              {/* Simulation */}
              <div className="p-4 rounded-xl border-2 border-[#111111] bg-[#FFF3DD]">
                <div className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-2">
                  Rendu dans la barre de navigation :
                </div>
                <div className="flex items-center gap-2.5 py-2 px-3 rounded-lg border border-[#111111]/20 bg-white/60">
                  <img
                    src={headerPreviewUri}
                    alt="Aperçu nouveau logo de header"
                    className="h-10 w-auto max-w-[150px] object-contain"
                  />
                  <div className="flex flex-col">
                    <span className="font-extrabold text-[#111111] text-xs sm:text-sm uppercase font-['Space_Grotesk']">
                      Glorious Youth
                    </span>
                    <span className="text-[9px] font-bold text-[#FF6A00] uppercase">
                      6th Edition • 2027
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-green-700 font-bold">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Format {headerFormatLabel} vérifié • Zéro script malveillant.</span>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleSaveHeaderLogo}
                  disabled={isUploading}
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-[#2457FF] hover:bg-[#1a44d1] text-white font-black text-xs sm:text-sm py-3 px-4 rounded-xl border-2 border-[#111111] shadow-[3px_3px_0_0_#111111] cursor-pointer active:translate-x-0.5 active:translate-y-0.5 disabled:opacity-50 transition-all"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>{isUploading ? 'Enregistrement en cours...' : 'Enregistrer le logo du header'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setHeaderPreviewUri(null);
                    setHeaderRawSvg(null);
                    setHeaderFileName(null);
                  }}
                  disabled={isUploading}
                  className="px-4 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold text-xs rounded-xl border border-gray-400 cursor-pointer"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Security notice for administrators */}
      <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 text-xs text-gray-600 space-y-1.5">
        <div className="font-black text-[#111111] uppercase flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-[#5B2EFF]" />
          <span>Normes de sécurité & Invalidation de cache</span>
        </div>
        <p className="leading-relaxed">
          Chaque fichier importé (SVG, PNG, JPG, WebP) est soumis à une inspection rigoureuse : vérification du format et des dimensions, limite stricte de 2 Mo, assainissement automatique avec DOMPurify pour les SVG (élimination de tout script JavaScript ou ressource externe non sécurisée). Lors de la mise à jour, un timestamp de versioning (<code className="font-mono bg-gray-200 px-1 py-0.5 rounded">?v=timestamp</code>) est appliqué pour garantir que les visiteurs voient immédiatement la dernière version sans cache résiduel.
        </p>
      </div>
    </div>
  );
};
