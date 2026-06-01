from django import forms
from django.contrib.auth.forms import UserCreationForm
from .models import CustomUser


class RegisterForm(UserCreationForm):
    first_name = forms.CharField(
        max_length=50,
        required=True,
        label='Nome',
        widget=forms.TextInput(attrs={
            'placeholder': 'Seu nome completo',
            'class': 'w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500',
        }),
    )
    email = forms.EmailField(
        required=True,
        label='E-mail',
        widget=forms.EmailInput(attrs={
            'placeholder': 'seu@email.com',
            'class': 'w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500',
        }),
    )
    password1 = forms.CharField(
        label='Senha',
        widget=forms.PasswordInput(attrs={
            'placeholder': 'Mínimo 8 caracteres',
            'class': 'w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500',
        }),
    )
    password2 = forms.CharField(
        label='Confirmar senha',
        widget=forms.PasswordInput(attrs={
            'placeholder': 'Repita a senha',
            'class': 'w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500',
        }),
    )

    class Meta:
        model = CustomUser
        fields = ('first_name', 'email', 'password1', 'password2')

    def clean_email(self):
        email = self.cleaned_data.get('email', '').lower()
        if CustomUser.objects.filter(email=email).exists():
            raise forms.ValidationError('Este e-mail já está cadastrado.')
        return email

    def save(self, commit=True):
        user = super().save(commit=False)
        user.email = self.cleaned_data['email'].lower()
        user.username = user.email
        user.first_name = self.cleaned_data['first_name']
        if commit:
            user.save()
        return user
