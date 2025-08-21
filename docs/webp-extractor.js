/**
 * WebP Extractor Module
 * Handles extraction of WebP images from hex data
 */

class WebPExtractor {
    constructor() {
        this.riffSignature = '52494646';
        this.webpSignature = '57454250';
    }

    /**
     * Clean hex string by removing whitespace and converting to lowercase
     * @param {string} hexString - Raw hex string
     * @returns {string} Cleaned hex string
     */
    cleanHexString(hexString) {
        return hexString.replace(/\s/g, '').toLowerCase();
    }

    /**
     * Convert little-endian hex to decimal size
     * @param {string} sizeHex - 8-character hex string representing size
     * @returns {number} File size in bytes
     */
    parseLittleEndianSize(sizeHex) {
        const sizeBytes = [];
        for (let i = 0; i < 8; i += 2) {
            sizeBytes.unshift(parseInt(sizeHex.substring(i, i + 2), 16));
        }
        return new DataView(new Uint8Array(sizeBytes).buffer).getUint32(0, true);
    }

    /**
     * Find and extract WebP data from hex string
     * @param {string} hexData - Raw hex data
     * @returns {string|null} Extracted WebP hex data or null if not found
     */
    extractWebPData(hexData) {
        try {
            console.log('Analyzing hex data of length:', hexData.length / 2, 'bytes');
            console.log('First 100 bytes:', hexData.substring(0, 200));
            
            // Clean the hex string
            const cleanedHex = this.cleanHexString(hexData);
            
            // WebP file structure:
            // 4 bytes: "RIFF" (52494646)
            // 4 bytes: file size (little-endian)
            // 4 bytes: "WEBP" (57454250)
            // Rest: WebP data
            
            // Find RIFF signature
            const riffIndex = cleanedHex.indexOf(this.riffSignature);
            if (riffIndex === -1) {
                console.log('RIFF signature not found');
                return null;
            }
            
            console.log('Found RIFF signature at position:', riffIndex);
            
            // Check if we have enough data for the complete header
            if (riffIndex + 16 > cleanedHex.length) {
                console.log('Not enough data for complete WebP header');
                return null;
            }
            
            // Extract size field (4 bytes after RIFF)
            const sizeStart = riffIndex + 8;
            const sizeHex = cleanedHex.substring(sizeStart, sizeStart + 8);
            console.log('Size hex:', sizeHex);
            
            // Parse file size
            const fileSize = this.parseLittleEndianSize(sizeHex);
            console.log('WebP file size:', fileSize, 'bytes');
            
            // Check for WEBP signature after size field
            const webpIndex = riffIndex + 16;
            const actualWebpSignature = cleanedHex.substring(webpIndex, webpIndex + 8);
            
            if (actualWebpSignature !== this.webpSignature) {
                console.log('WEBP signature not found. Expected:', this.webpSignature, 'Found:', actualWebpSignature);
                return null;
            }
            
            console.log('Found valid WebP file structure');
            
            // Calculate end position: start + 8 (RIFF + size) + fileSize
            const endIndex = riffIndex + 8 + fileSize;
            
            // Extract the complete WebP data
            const webpHex = cleanedHex.substring(riffIndex, endIndex);
            
            console.log('Extracted WebP hex length:', webpHex.length / 2, 'bytes');
            console.log('WebP hex starts with:', webpHex.substring(0, 32));
            
            return webpHex;
            
        } catch (error) {
            console.error('Error extracting WebP data:', error);
            return null;
        }
    }

    /**
     * Convert hex string to image URL
     * @param {string} hexData - WebP hex data
     * @returns {string|null} Object URL for the image or null if failed
     */
    hexToImage(hexData) {
        try {
            // Convert hex string to Uint8Array
            const bytes = new Uint8Array(hexData.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
            
            // Create blob from bytes
            const blob = new Blob([bytes], { type: 'image/webp' });
            
            // Create object URL
            const imageUrl = URL.createObjectURL(blob);
            return imageUrl;
        } catch (error) {
            console.error('Error decoding hex to image:', error);
            return null;
        }
    }

    /**
     * Extract WebP from transaction data
     * @param {Object} txData - Transaction data from mempool.space API
     * @returns {Object|null} Object with imageUrl and controlBlockHex or null if not found
     */
    extractFromTransaction(txData) {
        console.log('Extracting WebP from transaction data...');
        
        // First, try to extract from Taproot witness data
        if (txData.vin && txData.vin.length > 0) {
            console.log('Checking Taproot witness data...');
            
            for (let i = 0; i < txData.vin.length; i++) {
                const vin = txData.vin[i];
                console.log(`Checking input ${i}:`, vin.witness ? 'has witness' : 'no witness');
                
                if (vin.witness && vin.witness.length > 0) {
                    // Join all witness data into one hex string
                    const witnessHex = vin.witness.join('');
                    console.log(`Input ${i} witness data length:`, witnessHex.length / 2, 'bytes');
                    
                    // Try to extract WebP from witness data
                    const webpHex = this.extractWebPData(witnessHex);
                    if (webpHex) {
                        const imageUrl = this.hexToImage(webpHex);
                        if (imageUrl) {
                            console.log(`Found image in Taproot witness for input ${i}`);
                            return {
                                imageUrl,
                                controlBlockHex: witnessHex,
                                witnessHex: webpHex,
                                source: `Taproot witness (input ${i})`
                            };
                        }
                    }
                }
            }
        }
        
        // If no image found in witness, check transaction hex data
        if (txData.hex) {
            const hexString = txData.hex;
            console.log('Analyzing transaction hex data...');
            
            // Try to extract WebP from control block
            const webpHex = this.extractWebPData(hexString);
            if (webpHex) {
                const imageUrl = this.hexToImage(webpHex);
                if (imageUrl) {
                    return {
                        imageUrl,
                        controlBlockHex: hexString,
                        source: 'Transaction hex data'
                    };
                }
            }
        }

        // If no image found in hex, try to look for control block data in outputs
        if (txData.vout) {
            console.log('Searching in transaction outputs...');
            // Look through outputs for control block data
            for (let i = 0; i < txData.vout.length; i++) {
                const output = txData.vout[i];
                console.log(`Checking output ${i}:`, output.scriptpubkey ? 'has scriptpubkey' : 'no scriptpubkey');
                
                if (output.scriptpubkey && output.scriptpubkey.hex) {
                    const scriptHex = output.scriptpubkey.hex;
                    console.log(`Output ${i} scriptpubkey length:`, scriptHex.length / 2, 'bytes');
                    
                    // Try to extract WebP from scriptpubkey
                    const webpHex = this.extractWebPData(scriptHex);
                    if (webpHex) {
                        const imageUrl = this.hexToImage(webpHex);
                        if (imageUrl) {
                            console.log(`Found image in output ${i}`);
                            return {
                                imageUrl,
                                controlBlockHex: scriptHex,
                                source: `Output ${i} scriptpubkey`
                            };
                        }
                    }
                }
            }
        }

        // If still no image, try a more aggressive search
        console.log('Performing aggressive search for image data...');
        
        // Search for any hex data that might contain images
        const allHexData = [
            txData.hex,
            ...(txData.vout || []).map(vout => vout.scriptpubkey?.hex).filter(Boolean),
            ...(txData.vin || []).map(vin => vin.witness ? vin.witness.join('') : '').filter(Boolean)
        ];
        
        for (let hexData of allHexData) {
            if (!hexData) continue;
            
            // Look for any image format signatures
            const imageSignatures = [
                { sig: '52494646', name: 'WebP' }, // RIFF signature for WebP
                { sig: '89504e47', name: 'PNG' },
                { sig: 'ffd8ffe0', name: 'JPEG' },
                { sig: '47494638', name: 'GIF' }
            ];
            
            for (let sig of imageSignatures) {
                const index = hexData.indexOf(sig.sig);
                if (index !== -1) {
                    console.log(`Found ${sig.name} signature at position:`, index);
                    
                    // Try to extract the image data
                    let extractedHex = null;
                    
                    if (sig.name === 'WebP') {
                        // For WebP, use the proper extraction function starting from the RIFF signature
                        extractedHex = this.extractWebPData(hexData.substring(index));
                    } else {
                        // For other formats, try to extract a reasonable amount of data
                        const maxSize = 100000; // 100KB max
                        extractedHex = hexData.substring(index, index + maxSize * 2);
                    }
                    
                    if (extractedHex) {
                        const imageUrl = this.hexToImage(extractedHex);
                        if (imageUrl) {
                            console.log(`Successfully extracted ${sig.name} image`);
                            return {
                                imageUrl,
                                controlBlockHex: hexData,
                                source: `Aggressive search - ${sig.name}`
                            };
                        }
                    }
                }
            }
        }

        console.log('No WebP image found in transaction data');
        return null;
    }

    /**
     * Fetch transaction data from mempool.space API
     * @param {string} txid - Transaction ID
     * @returns {Promise<Object|null>} Transaction data or null if failed
     */
    async fetchTransactionData(txid) {
        try {
            const response = await fetch(`https://mempool.space/api/tx/${txid}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            return data;
        } catch (error) {
            console.error(`Error fetching transaction ${txid}:`, error);
            return null;
        }
         }

     /**
      * Apply transparency mask to an image using labitbu-map.png
      * @param {string} sourceImageUrl - URL of the source image
      * @returns {Promise<string>} Object URL for the masked image
      */
     async applyTransparencyMask(sourceImageUrl) {
         return new Promise((resolve, reject) => {
             // Load the source image
             const sourceImage = new Image();
             sourceImage.crossOrigin = 'anonymous';
             sourceImage.onload = () => {
                 // Load the mask image
                 const maskImage = new Image();
                 maskImage.crossOrigin = 'anonymous';
                 maskImage.onload = () => {
                     try {
                         // Create canvas for processing
                         const canvas = document.createElement('canvas');
                         const ctx = canvas.getContext('2d');
                         
                         // Set canvas size to match source image
                         canvas.width = sourceImage.width;
                         canvas.height = sourceImage.height;
                         
                         // Draw source image
                         ctx.drawImage(sourceImage, 0, 0);
                         
                         // Get image data
                         const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                         const data = imageData.data;
                         
                         // Create temporary canvas for mask
                         const maskCanvas = document.createElement('canvas');
                         const maskCtx = maskCanvas.getContext('2d');
                         maskCanvas.width = canvas.width;
                         maskCanvas.height = canvas.height;
                         
                         // Draw mask image scaled to match source
                         maskCtx.drawImage(maskImage, 0, 0, canvas.width, canvas.height);
                         
                         // Get mask data
                         const maskData = maskCtx.getImageData(0, 0, canvas.width, canvas.height);
                         const maskPixels = maskData.data;
                         
                         // Apply transparency based on mask
                         for (let i = 0; i < data.length; i += 4) {
                             const maskIndex = i;
                             const red = maskPixels[maskIndex];
                             const green = maskPixels[maskIndex + 1];
                             const blue = maskPixels[maskIndex + 2];
                             
                             // Calculate transparency based on mask
                             // Red pixels = fully transparent (alpha = 0)
                             // White pixels = fully opaque (alpha = 255)
                             // Other colors = interpolated transparency
                             let alpha = 255;
                             
                             if (red > green && red > blue) {
                                 // Red pixel - make transparent
                                 alpha = 0;
                             } else if (red === green && green === blue) {
                                 // Grayscale - use red channel as alpha
                                 alpha = red;
                             } else {
                                 // Other colors - calculate average and use as alpha
                                 alpha = Math.round((red + green + blue) / 3);
                             }
                             
                             // Apply alpha to source image
                             data[i + 3] = alpha;
                         }
                         
                         // Put the modified image data back
                         ctx.putImageData(imageData, 0, 0);
                         
                         // Convert to blob URL
                         canvas.toBlob((blob) => {
                             const maskedImageUrl = URL.createObjectURL(blob);
                             resolve(maskedImageUrl);
                         }, 'image/png');
                         
                     } catch (error) {
                         reject(error);
                     }
                 };
                 
                 maskImage.onerror = () => {
                     reject(new Error('Failed to load labitbu-map.png'));
                 };
                 
                 // Load the mask image
                 maskImage.src = 'labitbu-map.png';
             };
             
             sourceImage.onerror = () => {
                 reject(new Error('Failed to load source image'));
             };
             
             sourceImage.src = sourceImageUrl;
         });
     }

     /**
      * Main extraction function
      * @param {string} txid - Transaction ID
      * @returns {Promise<Object|null>} Extraction result or null if failed
      */
    async extractImage(txid) {
        try {
            // Fetch transaction data
            const txData = await this.fetchTransactionData(txid);
            if (!txData) {
                throw new Error('Failed to fetch transaction data');
            }

            // Extract WebP from transaction
            const result = this.extractFromTransaction(txData);
            
                         if(result.witnessHex){
                 // Apply transparency mask using labitbu-map.png
                 if (result.imageUrl) {
                     const maskedImageUrl = await this.applyTransparencyMask(result.imageUrl);
                     if (maskedImageUrl) {
                         result.imageUrl = maskedImageUrl;
                     }
                 }
             }
            
            if (result) {
                return {
                    success: true,
                    imageUrl: result.imageUrl,
                    controlBlockHex: result.controlBlockHex,
                    source: result.source,
                    txData: txData
                };
            } else {
                return {
                    success: false,
                    txData: txData,
                    error: 'No WebP image data detected in the control block'
                };
            }
            
        } catch (error) {
            console.error('Error extracting image:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebPExtractor;
}

// Make available globally for browser use
if (typeof window !== 'undefined') {
    window.WebPExtractor = WebPExtractor;
} 