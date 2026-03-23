'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Loader2, Beer } from 'lucide-react';

interface AddBeerFormProps {
  onBack: () => void;
  onSuccess: (beerId: string) => void;
}

type CreateBeerResponse = {
  error?: string;
  duplicate?: boolean;
  beer?: {
    id?: string;
    _id?: string;
  };
};

export function AddBeerForm({ onBack, onSuccess }: Readonly<AddBeerFormProps>) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Form fields
  const [name, setName] = useState('');
  const [brewery, setBrewery] = useState('');
  const [style, setStyle] = useState('');
  const [abv, setAbv] = useState('');
  const [ibu, setIbu] = useState('');
  const [description, setDescription] = useState('');
  const [country, setCountry] = useState('');
  const [image, setImage] = useState('');

  const beerStyles = [
    'Lager', 'Pilsner', 'IPA', 'Pale Ale', 'Stout', 'Porter', 
    'Wheat Beer', 'Belgian Ale', 'Sour', 'Brown Ale', 'Red Ale',
    'Amber Ale', 'Bock', 'Weissbier', 'Tripel', 'Quadrupel'
  ];

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    if (!name || !brewery || !style || !abv) {
      setError('Nome, cervejeira, estilo e ABV são obrigatórios');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/beers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          brewery,
          style,
          abv: Number.parseFloat(abv),
          ibu: ibu ? Number.parseInt(ibu, 10) : null,
          description,
          country,
          image
        })
      });

      const data: CreateBeerResponse = await res.json();

      const returnedBeerId = data?.beer?.id || data?.beer?._id;

      if (res.status === 409 && data.duplicate && returnedBeerId) {
        setError('Essa cerveja já existe. Vou abrir a cerveja existente.');
        onSuccess(returnedBeerId);
        return;
      }

      if (!res.ok) {
        setError(data.error || 'Erro ao adicionar cerveja');
        return;
      }

      const createdBeerId = returnedBeerId;
      if (!createdBeerId) {
        setError('Cerveja criada, mas não foi possível abrir os detalhes');
        return;
      }

      onSuccess(createdBeerId);
    } catch (error) {
      console.error('Error adding beer:', error);
      setError('Erro ao adicionar cerveja');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft className="h-4 w-4 mr-2" />
        Voltar
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Beer className="h-6 w-6 text-amber-500" />
            <CardTitle>Adicionar Nova Cerveja</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome da Cerveja *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Super Bock"
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="brewery">Cervejeira *</Label>
                <Input
                  id="brewery"
                  value={brewery}
                  onChange={(e) => setBrewery(e.target.value)}
                  placeholder="Ex: Super Bock Group"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="style">Estilo *</Label>
                <select
                  id="style"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  required
                >
                  <option value="">Seleciona um estilo</option>
                  {beerStyles.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="abv">ABV (%) *</Label>
                <Input
                  id="abv"
                  type="number"
                  step="0.1"
                  min="0"
                  max="20"
                  value={abv}
                  onChange={(e) => setAbv(e.target.value)}
                  placeholder="Ex: 5.2"
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="ibu">IBU</Label>
                <Input
                  id="ibu"
                  type="number"
                  min="0"
                  max="120"
                  value={ibu}
                  onChange={(e) => setIbu(e.target.value)}
                  placeholder="Ex: 45"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="country">País de Origem</Label>
                <Input
                  id="country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="Ex: Portugal"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="image">URL da Imagem</Label>
                <Input
                  id="image"
                  type="url"
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descrição</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descreve a cerveja..."
                rows={4}
              />
            </div>

            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}

            <Button type="submit" disabled={isLoading} className="w-full md:w-auto">
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Adicionar Cerveja
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
